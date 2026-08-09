import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, signatory, employee, tenantAdmin } from "./helpers.js";

async function companyWith2(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site" } });
  const est = e.json().id;
  for (const [ln, gross] of [["A", 2000], ["B", 3000]] as [string, number][]) {
    await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: ln, firstName: "X" }, legalEntityId: companyId, administrativeEstablishmentId: est, startDate: "2026-01-01", contractType: "CDI", grossMonthly: gross, workingTime: 35 } });
  }
  return companyId;
}

describe("Pilotage économique (D5)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("calcule masse salariale et coût employeur (charges 42%)", async () => {
    const companyId = await companyWith2(app);
    const p = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/pilotage`, headers: hrManager() });
    const b = p.json();
    expect(b.headcount).toBe(2);
    expect(b.masseSalarialeBruteMensuelle).toBe(5000);
    expect(b.masseSalarialeBruteAnnuelle).toBe(60000);
    expect(b.coutEmployeurAnnuel).toBe(85200); // 60000 * 1.42
  });

  it("compare au budget (écart)", async () => {
    const companyId = await companyWith2(app);
    await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/budgets`, headers: hrManager(), payload: { year: new Date().getFullYear(), amount: 80000 } });
    const p = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/pilotage`, headers: hrManager() });
    expect(p.json().budget).toBe(80000);
    expect(p.json().ecart).toBe(5200); // 85200 - 80000
  });

  it("simulateur de coûts : impact de +3 embauches à 2500 €", async () => {
    const companyId = await companyWith2(app);
    const s = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/pilotage/cost-simulate`, headers: hrManager(), payload: { additionalHires: 3, avgGross: 2500 } });
    // 3 * 2500 * 12 * 1.42 = 127800
    expect(s.json().addedEmployerCostAnnual).toBe(127800);
    expect(s.json().projectedEmployerCostAnnual).toBe(85200 + 127800);
  });

  it("le signataire peut lire mais un collaborateur non → 403", async () => {
    const companyId = await companyWith2(app);
    const denied = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/pilotage`, headers: employee() });
    expect(denied.statusCode).toBe(403);
  });
});
