import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, tenantAdmin } from "./helpers.js";

async function company(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site" } });
  return { companyId, establishmentId: e.json().id };
}
async function hireN(app: any, companyId: string, establishmentId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await app.inject({
      method: "POST", url: "/api/v1/employments", headers: hrManager(),
      payload: { person: { lastName: `N${i}`, firstName: "X" }, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, startDate: "2026-01-01", contractType: "CDI" },
    });
  }
}

describe("Effectif → seuils → obligations (D1)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("calcule l'effectif actif", async () => {
    const { companyId, establishmentId } = await company(app);
    await hireN(app, companyId, establishmentId, 3);
    const wf = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/workforce`, headers: hrManager() });
    expect(wf.json().headcount).toBe(3);
    expect(wf.json().applicableObligations.length).toBe(0); // sous le seuil 11
  });

  it("déclenche l'obligation CSE au franchissement du seuil 11", async () => {
    const { companyId, establishmentId } = await company(app);
    await hireN(app, companyId, establishmentId, 11);
    const wf = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/workforce`, headers: hrManager() });
    expect(wf.json().headcount).toBe(11);

    const obs = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/obligations`, headers: hrManager() });
    const codes = obs.json().map((o: any) => o.code);
    expect(codes).toContain("CSE_ELECTION");

    expect(app.bus.eventsOf("ACME", "WorkforceThresholdCrossed").length).toBeGreaterThanOrEqual(1);
    expect(app.bus.eventsOf("ACME", "ObligationTriggered").length).toBeGreaterThanOrEqual(1);
  });

  it("les obligations ne sont pas dupliquées (idempotent)", async () => {
    const { companyId, establishmentId } = await company(app);
    await hireN(app, companyId, establishmentId, 13);
    const obs = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/obligations`, headers: hrManager() });
    const cse = obs.json().filter((o: any) => o.code === "CSE_ELECTION");
    expect(cse.length).toBe(1);
  });

  it("simule l'impact d'embauches sans rien écrire", async () => {
    const { companyId, establishmentId } = await company(app);
    await hireN(app, companyId, establishmentId, 11);
    const sim = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/workforce/simulate`, headers: hrManager(), payload: { additionalHires: 9 } });
    const body = sim.json();
    expect(body.current).toBe(11);
    expect(body.projected).toBe(20);
    expect(body.crossedThresholds).toContain(20);
    expect(body.newObligations.map((o: any) => o.code)).toContain("REGLEMENT_INTERIEUR");

    // la simulation n'a pas créé d'obligation seuil 20
    const obs = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/obligations`, headers: hrManager() });
    expect(obs.json().map((o: any) => o.code)).not.toContain("REGLEMENT_INTERIEUR");
  });
});
