// D10 — Coffre-fort & documents (Tome 16). Critères de sortie : intégrité
// vérifiable (altération détectée), legal hold bloque la suppression, document
// signé immuable, notification sans contenu sensible. + cycle de vie, templates,
// DELETE/ANONYMIZE/ARCHIVE, archivage automatique au départ, admin sans contenu.
import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "crypto";
import { build } from "../src/app.js";
import { hrManager, signatory, employee, setupHire } from "./helpers.js";
import { signToken } from "../src/jwt.js";

const flush = () => new Promise((r) => setTimeout(r, 10)); // laisse tourner l'archivage async
const deposit = (app: any, personId: string, body: any) =>
  app.inject({ method: "POST", url: `/api/v1/persons/${personId}/documents`, headers: hrManager(), payload: body });

describe("D10 — Intégrité (WORM) & immuabilité du signé", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("l'altération est détectée par le contrôle d'intégrité", async () => {
    const { personId } = await setupHire(app);
    const content = "CONTRAT — Marie Dupont";
    const id = (await deposit(app, personId, { type: "CONTRACT", label: "CDI", content })).json().id;
    // contenu authentique → valide
    expect((await app.inject({ method: "POST", url: `/api/v1/documents/${id}/verify`, headers: hrManager(), payload: { content } })).json().valid).toBe(true);
    // contenu altéré → invalide
    expect((await app.inject({ method: "POST", url: `/api/v1/documents/${id}/verify`, headers: hrManager(), payload: { content: content + "X" } })).json().valid).toBe(false);
  });

  it("un document signé est immuable (pas de retour à un état antérieur, pas de re-signature)", async () => {
    const { personId } = await setupHire(app);
    const id = (await deposit(app, personId, { type: "CONTRACT", label: "CDI", content: "abc" })).json().id;
    const otp = (await app.inject({ method: "POST", url: `/api/v1/documents/${id}/signature/request`, headers: hrManager(), payload: { signers: ["dg"] } })).json().challenge.otp;
    await app.inject({ method: "POST", url: `/api/v1/documents/${id}/signature/sign`, headers: signatory(), payload: { otp } });
    // signé → on ne peut pas revalider (retour en arrière)
    expect((await app.inject({ method: "POST", url: `/api/v1/documents/${id}/validate`, headers: hrManager() })).statusCode).toBe(409);
    // mais on peut publier (état aval)
    expect((await app.inject({ method: "POST", url: `/api/v1/documents/${id}/publish`, headers: hrManager() })).json().status).toBe("PUBLISHED");
    // pas de re-signature
    expect((await app.inject({ method: "POST", url: `/api/v1/documents/${id}/signature/sign`, headers: signatory(), payload: { otp } })).statusCode).toBe(409);
  });
});

describe("D10 — Legal hold, DELETE / ANONYMIZE / ARCHIVE", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("legal hold empêche la suppression (le hold prime)", async () => {
    const { personId } = await setupHire(app);
    // rétention déjà échue → normalement supprimable
    const id = (await deposit(app, personId, { type: "OTHER", label: "vieux", content: "x", retentionUntil: "2020-01-01" })).json().id;
    await app.inject({ method: "POST", url: `/api/v1/documents/${id}/legal-hold`, headers: hrManager(), payload: { hold: true } });
    const blocked = await app.inject({ method: "DELETE", url: `/api/v1/documents/${id}`, headers: hrManager() });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("legal_hold");
    // levée du hold → suppression possible (rétention échue)
    await app.inject({ method: "POST", url: `/api/v1/documents/${id}/legal-hold`, headers: hrManager(), payload: { hold: false } });
    expect((await app.inject({ method: "DELETE", url: `/api/v1/documents/${id}`, headers: hrManager() })).json().deleted).toBe(true);
  });

  it("DELETE bloqué si rétention non échue ; ANONYMIZE et ARCHIVE conservent l'enregistrement", async () => {
    const { personId } = await setupHire(app);
    // rétention future → DELETE refusé
    const id = (await deposit(app, personId, { type: "CONTRACT", label: "c", content: "x", retentionUntil: "2099-01-01" })).json().id;
    expect((await app.inject({ method: "DELETE", url: `/api/v1/documents/${id}`, headers: hrManager() })).json().code).toBe("retention_active");
    // ANONYMIZE : conserve l'enregistrement, retire les rattachements
    const anon = await app.inject({ method: "POST", url: `/api/v1/documents/${id}/anonymize`, headers: hrManager() });
    expect(anon.json().anonymizedAt).toBeTruthy();
    expect(app.db.documents.find((d: any) => d.id === id)).toBeTruthy(); // toujours présent
    // ARCHIVE : conserve (statut ARCHIVED)
    const id2 = (await deposit(app, personId, { type: "CONTRACT", label: "c2", content: "y", retentionUntil: "2099-01-01" })).json().id;
    expect((await app.inject({ method: "POST", url: `/api/v1/documents/${id2}/archive`, headers: hrManager() })).json().status).toBe("ARCHIVED");
    expect(app.db.documents.find((d: any) => d.id === id2)).toBeTruthy();
  });
});

describe("D10 — Notifications sans contenu, droits, templates, archivage au départ", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("les événements ne portent aucun contenu sensible (ni libellé ni corps)", async () => {
    const { personId } = await setupHire(app);
    const id = (await deposit(app, personId, { type: "CONTRACT", label: "SECRET libellé sensible", content: "corps confidentiel" })).json().id;
    await app.inject({ method: "POST", url: `/api/v1/documents/${id}/signature/request`, headers: hrManager(), payload: { signers: ["dg"] } });
    const deposited = app.bus.eventsOf("ACME", "DocumentDeposited")[0].payload;
    const requested = app.bus.eventsOf("ACME", "SignatureRequested")[0].payload;
    for (const p of [deposited, requested]) {
      const s = JSON.stringify(p);
      expect(s).not.toContain("SECRET");
      expect(s).not.toContain("confidentiel");
      expect(p.label).toBeUndefined();
      expect(p.content).toBeUndefined();
    }
  });

  it("l'admin technique (PlatformAdmin, sans document.read) n'accède pas au contenu", async () => {
    const { personId } = await setupHire(app);
    const admin = { authorization: `Bearer ${signToken({ sub: "ita", tenantId: "ACME", roles: ["PlatformAdmin"] })}` };
    expect((await app.inject({ method: "GET", url: `/api/v1/persons/${personId}/documents`, headers: admin })).statusCode).toBe(403);
  });

  it("génération par template : refuse si donnée requise manquante, sinon dépose", async () => {
    const { personId } = await setupHire(app);
    const tpl = "Bonjour {{employee.first_name}} {{employee.last_name}}";
    // donnée manquante → impossible
    const ko = await app.inject({ method: "POST", url: "/api/v1/documents/generate", headers: hrManager(), payload: { personId, type: "CERTIFICATE", label: "Attestation", template: tpl, context: { employee: { first_name: "Marie" } } } });
    expect(ko.statusCode).toBe(422);
    expect(ko.json().message).toContain("information manquante");
    expect(ko.json().details.missing).toContain("employee.last_name");
    // toutes les données → dépôt
    const ok = await app.inject({ method: "POST", url: "/api/v1/documents/generate", headers: hrManager(), payload: { personId, type: "CERTIFICATE", label: "Attestation", template: tpl, context: { employee: { first_name: "Marie", last_name: "Dupont" } } } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().sha256).toBe(createHash("sha256").update("Bonjour Marie Dupont").digest("hex"));
  });

  it("au départ du collaborateur, ses documents sont archivés (coffre jamais détruit), accès conservé", async () => {
    const { personId, employmentId } = await setupHire(app);
    const id = (await deposit(app, personId, { type: "CONTRACT", label: "CDI", content: "abc" })).json().id;
    await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/departure`, headers: signatory(), payload: { endDate: "2026-06-30", reason: "démission" } });
    await flush();
    expect(app.db.documents.find((d: any) => d.id === id).status).toBe("ARCHIVED"); // archivé, pas supprimé
    // le collaborateur garde l'accès à ses propres documents
    const emp = { authorization: `Bearer ${signToken({ sub: "me", tenantId: "ACME", personId, roles: ["Employee"] })}` };
    expect((await app.inject({ method: "GET", url: "/api/v1/me/documents", headers: emp })).statusCode).toBe(200);
  });
});
