// Critères d'acceptation — Fonctionnalité « Onboarding entreprise (D1) ».
// Traduction 1-pour-1 de rheos-specs-d1-d2/acceptance/d1-d2.feature (ADR-018).
// Contexte : tenant "ACME" isolé + utilisateur "admin@acme" rôle "TenantAdmin".
import { describe, it, expect, beforeEach } from "vitest";
import { tenantAdmin, buildDB, resetDb } from "../helpers.js";

describe("Acceptation D1 — Onboarding entreprise (d1-d2.feature)", () => {
  let app: any;
  beforeEach(async () => { await resetDb(); app = await buildDB(); });

  // Scénario: Créer une entité juridique valide
  it("Créer une entité juridique valide → 201 + CompanyCreated + visible seulement dans ACME", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin("ACME"), payload: { legalName: "ACME SAS", siren: "552100554" } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;

    const events = app.bus.eventsOf("ACME", "CompanyCreated");
    expect(events.some((e: any) => e.aggregateId === id)).toBe(true);

    // visible dans ACME, invisible ailleurs (BETA)
    expect((await app.inject({ method: "GET", url: `/api/v1/companies/${id}`, headers: tenantAdmin("ACME") })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/companies/${id}`, headers: tenantAdmin("BETA") })).statusCode).toBe(404);
  });

  // Scénario: Refuser un SIREN au format invalide
  it("Refuser un SIREN au format invalide → 400 mentionnant « siren »", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin("ACME"), payload: { legalName: "X", siren: "12AB" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message.toLowerCase()).toContain("siren");
  });

  // Scénario: Interdire un SIREN en doublon dans le même tenant
  it("Interdire un SIREN en doublon dans le même tenant → 400", async () => {
    await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin("ACME"), payload: { legalName: "A", siren: "552100554" } });
    const dup = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin("ACME"), payload: { legalName: "B", siren: "552100554" } });
    expect(dup.statusCode).toBe(400);
  });

  // Scénario: Créer un établissement rattaché
  it("Créer un établissement rattaché → 201 + EstablishmentCreated", async () => {
    const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin("ACME"), payload: { legalName: "ACME SAS", siren: "552100554" } });
    const companyId = c.json().id;
    const est = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: tenantAdmin("ACME"), payload: { siret: "55210055400013", name: "Site Marseille" } });
    expect(est.statusCode).toBe(201);
    expect(app.bus.eventsOf("ACME", "EstablishmentCreated").some((e: any) => e.aggregateId === est.json().id)).toBe(true);
  });
});
