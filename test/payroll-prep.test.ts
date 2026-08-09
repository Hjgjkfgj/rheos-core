import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, signatory, manager, employee, tenantAdmin } from "./helpers.js";

async function setup(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site" } });
  const hire = await app.inject({
    method: "POST", url: "/api/v1/employments", headers: hrManager(),
    payload: { person: { lastName: "Paie", firstName: "Test" }, legalEntityId: companyId, administrativeEstablishmentId: e.json().id, startDate: "2025-01-01", contractType: "CDI", grossMonthly: 2200, workingTime: 35 },
  });
  return { companyId, employmentId: hire.json().employment.id };
}

describe("Préparation des variables de paie (D4)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("agrège base + congés approuvés de la période", async () => {
    const { employmentId } = await setup(app);
    // congé payé de 5 jours en juin 2026
    const lr = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/leave-requests`, headers: employee(), payload: { type: "PAID", startDate: "2026-06-10", endDate: "2026-06-14" } });
    await app.inject({ method: "POST", url: `/api/v1/leave-requests/${lr.json().id}/approve`, headers: manager() });

    const res = await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/payroll-input?year=2026&month=6`, headers: hrManager() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period).toBe("2026-06");
    expect(body.base.grossMonthly).toBe(2200);
    expect(body.base.workingTime).toBe(35);
    expect(body.leaves.find((l: any) => l.type === "PAID").days).toBe(5);
    expect(body.seniorityMonths).toBe(17); // 2025-01 → 2026-06
    expect(body.note).toContain("certifié");
  });

  it("ne compte pas un congé hors période", async () => {
    const { employmentId } = await setup(app);
    const lr = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/leave-requests`, headers: employee(), payload: { type: "PAID", startDate: "2026-07-01", endDate: "2026-07-05" } });
    await app.inject({ method: "POST", url: `/api/v1/leave-requests/${lr.json().id}/approve`, headers: manager() });
    const res = await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/payroll-input?year=2026&month=6`, headers: hrManager() });
    expect(res.json().leaves.length).toBe(0);
  });

  it("comptabilise les jours d'absence non rémunérée", async () => {
    const { employmentId } = await setup(app);
    const lr = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/leave-requests`, headers: employee(), payload: { type: "UNPAID", startDate: "2026-06-02", endDate: "2026-06-04" } });
    await app.inject({ method: "POST", url: `/api/v1/leave-requests/${lr.json().id}/approve`, headers: manager() });
    const res = await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/payroll-input?year=2026&month=6`, headers: hrManager() });
    expect(res.json().unpaidDays).toBe(3);
  });

  it("le lot d'entreprise agrège les collaborateurs actifs", async () => {
    const { companyId } = await setup(app);
    const res = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/payroll-batch?year=2026&month=6`, headers: hrManager() });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(1);
    expect(res.json().items[0].base.grossMonthly).toBe(2200);
  });

  it("un collaborateur ne peut pas préparer la paie → 403", async () => {
    const { employmentId } = await setup(app);
    const res = await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/payroll-input?year=2026&month=6`, headers: employee() });
    expect(res.statusCode).toBe(403);
  });
});
