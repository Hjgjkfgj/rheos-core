import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, employee, tenantAdmin } from "./helpers.js";

describe("Digital RH Officer — briefing quotidien", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("produit un briefing cohérent avec l'activité", async () => {
    const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
    const companyId = c.json().id;
    const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site" } });
    // 3 embauches aujourd'hui
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: `N${i}`, firstName: "X" }, legalEntityId: companyId, administrativeEstablishmentId: e.json().id, startDate: "2026-01-01", contractType: "CDI" } });
    }

    const res = await app.inject({ method: "GET", url: "/api/v1/rh-officer/briefing", headers: hrManager() });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.workforce.headcount).toBe(3);
    expect(b.workforce.nextThreshold.threshold).toBe(11);
    expect(b.workforce.nextThreshold.remaining).toBe(8);
    expect(b.activityToday.hires).toBe(3);          // 3 embauches ce jour
    expect(b.alerts.ACTION).toBeGreaterThanOrEqual(3); // 3 contrats à signer
    expect(b.recommendations.join(" ")).toContain("contrat");
    expect(b.narrative).toContain("Effectif actuel : 3");
  });

  it("recommande d'anticiper quand on approche d'un seuil", async () => {
    const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
    const companyId = c.json().id;
    const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site" } });
    for (let i = 0; i < 9; i++) {
      await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: `N${i}`, firstName: "X" }, legalEntityId: companyId, administrativeEstablishmentId: e.json().id, startDate: "2026-01-01", contractType: "CDI" } });
    }
    const res = await app.inject({ method: "GET", url: "/api/v1/rh-officer/briefing", headers: hrManager() });
    // 9 → reste 2 avant le seuil 11
    expect(res.json().workforce.nextThreshold.remaining).toBe(2);
    expect(res.json().recommendations.join(" ")).toContain("seuil 11");
  });

  it("un collaborateur n'a pas accès au briefing → 403", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/rh-officer/briefing", headers: employee() });
    expect(res.statusCode).toBe(403);
  });
});
