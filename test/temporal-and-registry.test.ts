import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, signatory, tenantAdmin } from "./helpers.js";

async function hireOne(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site Marseille" } });
  const marseille = await app.inject({ method: "POST", url: `/api/v1/establishments/${e.json().id}/operating-sites`, headers: hrManager(), payload: { name: "Site Marseille" } });
  const aix = await app.inject({ method: "POST", url: `/api/v1/establishments/${e.json().id}/operating-sites`, headers: hrManager(), payload: { name: "Site Aix" } });
  const hire = await app.inject({
    method: "POST", url: "/api/v1/employments", headers: hrManager(),
    payload: { person: { lastName: "Dupont", firstName: "Marie" }, legalEntityId: companyId, administrativeEstablishmentId: e.json().id, operatingSiteId: marseille.json().id, startDate: "2026-09-01", contractType: "CDI" },
  });
  return { companyId, employmentId: hire.json().employment.id, marseille: marseille.json().id, aix: aix.json().id };
}

describe("Historisation & requête temporelle (ADR-004)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("reconstruit l'affectation à une date passée/future", async () => {
    const { employmentId, marseille, aix } = await hireOne(app);
    // mobilité vers Aix au 2026-10-01
    await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/assignments`, headers: hrManager(), payload: { operatingSiteId: aix, validFrom: "2026-10-01" } });

    const before = await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/employee360?asOf=2026-09-15`, headers: hrManager() });
    expect(before.json().currentAssignment.operatingSiteId).toBe(marseille);

    const after = await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/employee360?asOf=2026-10-15`, headers: hrManager() });
    expect(after.json().currentAssignment.operatingSiteId).toBe(aix);
  });

  it("une mobilité ne détruit pas l'historique (ancienne affectation clôturée, conservée)", async () => {
    const { employmentId, aix } = await hireOne(app);
    await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/assignments`, headers: hrManager(), payload: { operatingSiteId: aix, validFrom: "2026-10-01" } });
    const assignments = app.db.assignments.filter((a: any) => a.employmentId === employmentId);
    expect(assignments.length).toBe(2);
    const closed = assignments.find((a: any) => a.validTo);
    expect(closed.validTo).toBe("2026-09-30");
  });
});

describe("Sortie & registre (D1 + D2)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("déclarer une sortie émet EmployeeDeparture", async () => {
    const { employmentId } = await hireOne(app);
    const res = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/departure`, headers: signatory(), payload: { endDate: "2027-03-31", reason: "démission" } });
    expect(res.statusCode).toBe(200);
    expect(["EXITING", "ENDED"]).toContain(res.json().status);
    expect(app.bus.eventsOf("ACME", "EmployeeDeparture").length).toBe(1);
  });

  it("le RUP est généré depuis les données structurées", async () => {
    const { companyId } = await hireOne(app);
    const res = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/registry`, headers: hrManager() });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows.length).toBe(1);
    expect(rows[0].lastName).toBe("Dupont");
    expect(rows[0].contractType).toBe("CDI");
  });
});
