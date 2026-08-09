import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, manager, employee, tenantAdmin } from "./helpers.js";

async function setup(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site" } });
  const hire = await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: "Temps", firstName: "Test" }, legalEntityId: companyId, administrativeEstablishmentId: e.json().id, startDate: "2025-01-01", contractType: "CDI", grossMonthly: 2000, workingTime: 35 } });
  return { companyId, employmentId: hire.json().employment.id };
}

describe("Planning & pointage (D3)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("planifie des shifts et calcule les heures", async () => {
    const { employmentId } = await setup(app);
    const s = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/shifts`, headers: manager(), payload: { date: "2026-06-02", startTime: "09:00", endTime: "17:00" } });
    expect(s.statusCode).toBe(201);
    expect(s.json().hours).toBe(8);
  });

  it("enregistre le pointage et produit une synthèse d'écart", async () => {
    const { employmentId } = await setup(app);
    await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/shifts`, headers: manager(), payload: { date: "2026-06-02", startTime: "09:00", endTime: "17:00" } }); // 8h prévues
    await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/shifts`, headers: manager(), payload: { date: "2026-06-03", startTime: "09:00", endTime: "17:00" } }); // 8h prévues
    await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/time-entries`, headers: employee(), payload: { date: "2026-06-02", clockIn: "09:00", clockOut: "17:00" } }); // 8h
    await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/time-entries`, headers: employee(), payload: { date: "2026-06-03", clockIn: "09:00", clockOut: "18:00" } }); // 9h

    const sum = await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/time-summary?year=2026&month=6`, headers: hrManager() });
    const b = sum.json();
    expect(b.plannedHours).toBe(16);
    expect(b.workedHours).toBe(17);
    expect(b.variance).toBe(1);
  });

  it("les heures travaillées alimentent les variables de paie", async () => {
    const { employmentId } = await setup(app);
    // 20 pointages de 8h en juin = 160h > base mensuelle (151,67) → heures supp
    for (let d = 1; d <= 20; d++) {
      const day = String(d).padStart(2, "0");
      await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/time-entries`, headers: employee(), payload: { date: `2026-06-${day}`, clockIn: "09:00", clockOut: "17:00" } });
    }
    const res = await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/payroll-input?year=2026&month=6`, headers: hrManager() });
    const b = res.json();
    expect(b.workedHours).toBe(160);
    expect(b.overtimeHours).toBeGreaterThan(0); // 160 - 151,67
  });

  it("plage horaire invalide → 400", async () => {
    const { employmentId } = await setup(app);
    const res = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/shifts`, headers: manager(), payload: { date: "2026-06-02", startTime: "17:00", endTime: "09:00" } });
    expect(res.statusCode).toBe(400);
  });
});
