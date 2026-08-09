// Lot 8 — Revue sécurité : deny by default, en-têtes, rate limiting, et scénarios
// d'attaque (JWT falsifié/expiré, élévation RBAC/ABAC, cross-tenant, IDOR documents).
import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { signToken } from "../src/jwt.js";
import { hrManager, tenantAdmin, setupHire } from "./helpers.js";

const asMe = (personId: string, tenantId = "ACME") => ({ authorization: `Bearer ${signToken({ sub: "me", tenantId, personId, roles: ["Employee"] })}` });

describe("Sécurité — deny by default & en-têtes", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("toute route /api/v1 (hors auth) exige un jeton → 401", async () => {
    for (const url of ["/api/v1/companies", "/api/v1/notifications", "/api/v1/me", "/api/v1/rh-officer/briefing", "/api/v1/assistant/ask"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it("les en-têtes de sécurité sont posés", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });
});

describe("Sécurité — scénarios d'attaque", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("JWT falsifié (mauvais secret) même avec rôle élevé → 401", async () => {
    const forged = signToken({ sub: "x", tenantId: "ACME", roles: ["TenantAdmin"] }, { secret: "attacker-secret" });
    const res = await app.inject({ method: "POST", url: "/api/v1/companies", headers: { authorization: `Bearer ${forged}` }, payload: { legalName: "X", siren: "552100554" } });
    expect(res.statusCode).toBe(401);
  });

  it("JWT expiré → 401", async () => {
    const expired = signToken({ sub: "rh", tenantId: "ACME", roles: ["TenantAdmin"] }, { expiresInSec: -10 });
    const res = await app.inject({ method: "GET", url: "/api/v1/companies", headers: { authorization: `Bearer ${expired}` } });
    expect(res.statusCode).toBe(401);
  });

  it("élévation RBAC : un collaborateur ne peut pas créer d'entité (403)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/companies", headers: asMe("p1"), payload: { legalName: "X", siren: "552100554" } });
    expect(res.statusCode).toBe(403);
  });

  it("accès cross-tenant : A ne lit pas l'entité de B → 404", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin("BETA"), payload: { legalName: "BETA", siren: "552100554" } });
    const res = await app.inject({ method: "GET", url: `/api/v1/companies/${created.json().id}`, headers: tenantAdmin("ACME") });
    expect(res.statusCode).toBe(404);
  });

  it("IDOR documents : un collaborateur ne peut pas signer le document d'un autre → 404", async () => {
    const { personId } = await setupHire(app);
    const doc = await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/documents`, headers: hrManager(), payload: { type: "CONTRACT", label: "Contrat", content: "c" } });
    await app.inject({ method: "POST", url: `/api/v1/documents/${doc.json().id}/signature/request`, headers: hrManager(), payload: { signers: ["x"] } });
    // un autre collaborateur (personId différent) tente de signer
    const res = await app.inject({ method: "POST", url: `/api/v1/me/documents/${doc.json().id}/sign`, headers: asMe("intrus") });
    expect(res.statusCode).toBe(404);
  });

  it("rate limiting : le bruteforce d'authentification est bloqué (429)", async () => {
    let sawLimit = false;
    for (let i = 0; i < 25; i++) {
      const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "x@y", password: "z" } });
      if (r.statusCode === 429) { sawLimit = true; break; }
    }
    expect(sawLimit).toBe(true);
  });
});

describe("Sauvegarde / restauration", () => {
  it("un round-trip dump→mutation→load restaure fidèlement l'état", async () => {
    const { MemoryRepository } = await import("../src/repository.js");
    const repo = new MemoryRepository();
    const app = build(repo as any);
    await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
    const backup = repo.dump();
    expect(repo.legalEntities.length).toBe(1);
    // mutation destructrice
    repo.legalEntities = [];
    expect(repo.legalEntities.length).toBe(0);
    // restauration
    repo.load(backup);
    expect(repo.legalEntities.length).toBe(1);
    expect(repo.legalEntities[0].siren).toBe("552100554");
  });
});
