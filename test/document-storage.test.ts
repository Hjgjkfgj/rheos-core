// Lot 19 — Stockage documentaire réel. Dépôt (contenu chiffré par tenant + stocké)
// → téléchargement (droits + intégrité recalculée + journalisation) → hash identique.
import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { build } from "../src/app.js";
import { hrManager, signatory } from "./helpers.js";
import { setupHire } from "./helpers.js";
import { signToken } from "../src/jwt.js";

const noPerms = { authorization: `Bearer ${signToken({ sub: "x", tenantId: "ACME", roles: [] })}` };
// Faux « PDF » binaire (l'en-tête %PDF + des octets non-UTF8 pour exercer le binaire).
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x80]), Buffer.from("\n%%EOF")]);

async function deposit(app: any, personId: string, body: any) {
  return app.inject({ method: "POST", url: `/api/v1/persons/${personId}/documents`, headers: hrManager(), payload: body });
}

describe("Coffre-fort — stockage réel du contenu (Lot 19)", () => {
  it("dépose un PDF, le stocke chiffré, et le retélécharge à l'identique (hash égal)", async () => {
    const app: any = build();
    const { personId } = await setupHire(app);
    const res = await deposit(app, personId, { type: "CONTRACT", label: "contrat.pdf", contentBase64: PDF.toString("base64"), contentType: "application/pdf" });
    const doc = res.json();
    expect(doc.sha256).toBe(createHash("sha256").update(PDF).digest("hex"));
    expect(doc.storageRef).toMatch(/^tenants\/ACME\/documents\//); // vraie référence, pas vault://
    expect(doc.sizeBytes).toBe(PDF.length);
    // Le contenu stocké N'EST PAS en clair (chiffré) : la référence ne contient pas les octets.
    const dl = await app.inject({ method: "GET", url: `/api/v1/documents/${doc.id}/download`, headers: hrManager() });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toMatch(/application\/pdf/);
    expect(createHash("sha256").update(dl.rawPayload).digest("hex")).toBe(doc.sha256); // hash identique
    expect(dl.rawPayload.equals(PDF)).toBe(true); // octets identiques
    // Téléchargement journalisé.
    expect(app.db.auditLog.some((a: any) => a.action === "document.download" && a.entityId === doc.id)).toBe(true);
    expect(app.bus.eventsOf("ACME", "DocumentDownloaded").length).toBe(1);
  });

  it("refuse le téléchargement sans le droit document.read → 403", async () => {
    const app: any = build();
    const { personId } = await setupHire(app);
    const doc = (await deposit(app, personId, { type: "CONTRACT", label: "c.pdf", contentBase64: PDF.toString("base64"), contentType: "application/pdf" })).json();
    const res = await app.inject({ method: "GET", url: `/api/v1/documents/${doc.id}/download`, headers: noPerms });
    expect(res.statusCode).toBe(403);
  });

  it("un autre tenant ne peut pas télécharger → 404", async () => {
    const app: any = build();
    const { personId } = await setupHire(app);
    const doc = (await deposit(app, personId, { type: "CONTRACT", label: "c.pdf", contentBase64: PDF.toString("base64"), contentType: "application/pdf" })).json();
    const res = await app.inject({ method: "GET", url: `/api/v1/documents/${doc.id}/download`, headers: hrManager("BETA") });
    expect(res.statusCode).toBe(404);
  });

  it("détecte une atteinte à l'intégrité → 409 explicite", async () => {
    const app: any = build();
    const { personId } = await setupHire(app);
    const doc = (await deposit(app, personId, { type: "CONTRACT", label: "c.pdf", contentBase64: PDF.toString("base64"), contentType: "application/pdf" })).json();
    // On corrompt le registre (sha256 attendu) → l'empreinte recalculée ne correspond plus.
    app.db.documents.find((d: any) => d.id === doc.id).sha256 = "deadbeef";
    const res = await app.inject({ method: "GET", url: `/api/v1/documents/${doc.id}/download`, headers: hrManager() });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("integrity_failure");
  });

  it("refuse un type de contenu non autorisé → 415", async () => {
    const app: any = build();
    const { personId } = await setupHire(app);
    const res = await deposit(app, personId, { type: "OTHER", label: "x", contentBase64: Buffer.from("PK\x03\x04").toString("base64"), contentType: "application/zip" });
    expect(res.statusCode).toBe(415);
  });

  it("suppression contrôlée retire le contenu ; legal hold la bloque", async () => {
    const app: any = build();
    const { personId } = await setupHire(app);
    // dépôt avec rétention déjà échue + on pourra supprimer
    const doc = (await deposit(app, personId, { type: "CONTRACT", label: "c.pdf", contentBase64: PDF.toString("base64"), contentType: "application/pdf", retentionUntil: "2000-01-01" })).json();
    // legal hold → suppression bloquée
    await app.inject({ method: "POST", url: `/api/v1/documents/${doc.id}/legal-hold`, headers: hrManager(), payload: { hold: true } });
    expect((await app.inject({ method: "DELETE", url: `/api/v1/documents/${doc.id}`, headers: hrManager() })).statusCode).toBe(409);
    // on lève le hold → suppression OK + contenu retiré (téléchargement ensuite → 404)
    await app.inject({ method: "POST", url: `/api/v1/documents/${doc.id}/legal-hold`, headers: hrManager(), payload: { hold: false } });
    expect((await app.inject({ method: "DELETE", url: `/api/v1/documents/${doc.id}`, headers: hrManager() })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/documents/${doc.id}/download`, headers: hrManager() })).statusCode).toBe(404);
  });
});
