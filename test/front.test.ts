import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, tenantAdmin, setupHire } from "./helpers.js";
import { signToken } from "../src/jwt.js";
import { MemoryRepository } from "../src/repository.js";
import { AuthService } from "../src/auth-service.js";

describe("Porte d'entrée unique (Lot UI-1)", () => {
  it("la racine sert UNIQUEMENT la page de connexion (pas la console)", async () => {
    const app = build();
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Rhéos");
    expect(res.body).toContain("Se connecter");
    // La console (et ses modules) ne sont PAS exposés à la racine.
    expect(res.body).not.toContain("Gestion administrative");
  });

  it("la console est servie sur /console", async () => {
    const app = build();
    const res = await app.inject({ method: "GET", url: "/console" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Gestion administrative");
  });

  it("le login renvoie une redirection par rôle (profil de gestion → console)", async () => {
    // Compte créé à la volée (pas de dépendance aux comptes de démonstration, Lot UI-1c).
    const repo = new MemoryRepository();
    await new AuthService(repo).createAccount({ email: "admin@test.local", tenantId: "ACME", roleNames: ["TenantAdmin"], password: "phrase admin test" });
    const app = build(repo);
    const admin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "admin@test.local", password: "phrase admin test" } });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().redirect).toBe("/console");
    expect(admin.json().token).toBeTruthy();
  });

  it("les routes API restent protégées (deny by default)", async () => {
    const app = build();
    const res = await app.inject({ method: "GET", url: "/api/v1/notifications" });
    expect(res.statusCode).toBe(401);
  });
});

describe("Espace collaborateur — PWA installable", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("sert la page espace avec le manifest, le viewport et le vocabulaire officiel", async () => {
    const res = await app.inject({ method: "GET", url: "/espace" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('rel="manifest"');
    expect(res.body).toContain("viewport");
    expect(res.body).toContain("theme-color");
    expect(res.body).toContain("serviceWorker");
    // vocabulaire officiel : jamais salarié/employé
    expect(res.body.toLowerCase()).not.toMatch(/\bsalari[ée]/);
    expect(res.body).toContain("Collaborateur");
  });

  it("sert un manifest valide (name, start_url, display, icônes)", async () => {
    const res = await app.inject({ method: "GET", url: "/manifest.webmanifest" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("manifest");
    const m = res.json();
    expect(m.name).toBeTruthy();
    expect(m.start_url).toBe("/espace");
    expect(m.display).toBe("standalone");
    // installabilité : icônes PNG 192 ET 512 (exigence Lighthouse) + une maskable
    const png = m.icons.filter((i: any) => i.type === "image/png");
    expect(png.some((i: any) => i.sizes === "192x192")).toBe(true);
    expect(png.some((i: any) => i.sizes === "512x512")).toBe(true);
    expect(m.icons.some((i: any) => (i.purpose || "").includes("maskable"))).toBe(true);
  });

  it("sert le service worker et les icônes (SVG + PNG) avec les bons types", async () => {
    const sw = await app.inject({ method: "GET", url: "/sw.js" });
    expect(sw.statusCode).toBe(200);
    expect(sw.headers["content-type"]).toContain("javascript");
    expect(sw.body).toContain("addEventListener");
    expect((await app.inject({ method: "GET", url: "/icon.svg" })).headers["content-type"]).toContain("svg");
    for (const p of ["/icon-192.png", "/icon-512.png"]) {
      const r = await app.inject({ method: "GET", url: p });
      expect(r.statusCode, p).toBe(200);
      expect(r.headers["content-type"]).toContain("png");
    }
  });
});

describe("Espace collaborateur — parcours self-service (jeton seul)", () => {
  let app: any;
  beforeEach(() => { app = build(); });
  const asMe = (personId: string) => ({ authorization: `Bearer ${signToken({ sub: "me", tenantId: "ACME", personId, roles: ["Employee"] })}` });

  it("le collaborateur consulte ses données, signe un document en attente, pose un congé et voit son solde", async () => {
    const { personId, employmentId } = await setupHire(app);
    // un document en attente de signature du collaborateur
    const doc = await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/documents`, headers: hrManager(), payload: { type: "CONTRACT", label: "Contrat", content: "c" } });
    await app.inject({ method: "POST", url: `/api/v1/documents/${doc.json().id}/signature/request`, headers: hrManager(), payload: { signers: ["me"] } });

    // 1) consulter (mes données uniquement)
    expect((await app.inject({ method: "GET", url: "/api/v1/me", headers: asMe(personId) })).statusCode).toBe(200);
    // 2) signer SON document en attente
    const signed = await app.inject({ method: "POST", url: `/api/v1/me/documents/${doc.json().id}/sign`, headers: asMe(personId) });
    expect(signed.statusCode).toBe(200);
    expect(signed.json().signatureStatus).toBe("SIGNED");
    // 3) poser un congé
    const leave = await app.inject({ method: "POST", url: "/api/v1/me/leaves", headers: asMe(personId), payload: { type: "PAID", startDate: "2026-12-07", endDate: "2026-12-11" } });
    expect(leave.statusCode).toBe(201);
    // 4) voir son solde
    const me = await app.inject({ method: "GET", url: "/api/v1/me/leaves", headers: asMe(personId) });
    expect(me.json().balance.remaining).toBe(30); // solde plein (demande en cours = pending)
  });

  it("un collaborateur ne peut pas signer le document d'un autre (scopé au jeton)", async () => {
    const { personId } = await setupHire(app);
    const doc = await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/documents`, headers: hrManager(), payload: { type: "CONTRACT", label: "Contrat", content: "c" } });
    await app.inject({ method: "POST", url: `/api/v1/documents/${doc.json().id}/signature/request`, headers: hrManager(), payload: { signers: ["x"] } });
    const other = await app.inject({ method: "POST", url: `/api/v1/me/documents/${doc.json().id}/sign`, headers: asMe("someone-else") });
    expect(other.statusCode).toBe(404); // pas son document
  });
});
