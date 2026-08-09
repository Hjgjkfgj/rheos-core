import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, tenantAdmin } from "./helpers.js";

const iso = (deltaDays: number) => new Date(Date.now() + deltaDays * 86400000).toISOString().slice(0, 10);

async function base(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site" } });
  return { companyId, establishmentId: e.json().id };
}

describe("Veille & échéances", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("détecte une fin de CDD proche", async () => {
    const { companyId, establishmentId } = await base(app);
    await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: "CDD", firstName: "X" }, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, startDate: "2026-01-01", endDate: iso(20), contractType: "CDD" } });
    const res = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/deadlines`, headers: hrManager() });
    const cdd = res.json().items.find((i: any) => i.type === "CDD_END");
    expect(cdd).toBeTruthy();
    expect(cdd.status).toBe("DUE_SOON");
    expect(res.json().counts.DUE_SOON).toBeGreaterThanOrEqual(1);
  });

  it("échéance personnalisée en retard (visite médicale)", async () => {
    const { companyId, establishmentId } = await base(app);
    const h = await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: "V", firstName: "M" }, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, startDate: "2026-01-01", contractType: "CDI" } });
    await app.inject({ method: "POST", url: `/api/v1/employments/${h.json().employment.id}/deadlines`, headers: hrManager(), payload: { type: "MEDICAL_VISIT", label: "Visite médicale", dueDate: iso(-3) } });
    const res = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/deadlines`, headers: hrManager() });
    const v = res.json().items.find((i: any) => i.type === "MEDICAL_VISIT");
    expect(v.status).toBe("OVERDUE");
  });

  it("les échéances alimentent le centre de notifications", async () => {
    const { companyId, establishmentId } = await base(app);
    const h = await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: "V", firstName: "M" }, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, startDate: "2026-01-01", endDate: iso(15), contractType: "CDD" } });
    await app.inject({ method: "POST", url: `/api/v1/employments/${h.json().employment.id}/deadlines`, headers: hrManager(), payload: { type: "MEDICAL_VISIT", label: "Visite médicale", dueDate: iso(-1) } });
    const notif = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: hrManager() });
    const cats = notif.json().items.map((i: any) => i.category);
    expect(cats).toContain("deadline");     // échéance custom en retard
    expect(cats).toContain("contract_end"); // fin de CDD proche
    expect(notif.json().counts.CRITICAL).toBeGreaterThanOrEqual(1);
  });

  it("marquer une échéance comme traitée la retire des alertes", async () => {
    const { companyId, establishmentId } = await base(app);
    const h = await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: "V", firstName: "M" }, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, startDate: "2026-01-01", contractType: "CDI" } });
    const d = await app.inject({ method: "POST", url: `/api/v1/employments/${h.json().employment.id}/deadlines`, headers: hrManager(), payload: { type: "MEDICAL_VISIT", label: "Visite médicale", dueDate: iso(-3) } });
    await app.inject({ method: "POST", url: `/api/v1/deadlines/${d.json().id}/done`, headers: hrManager() });
    const res = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/deadlines`, headers: hrManager() });
    expect(res.json().items.find((i: any) => i.type === "MEDICAL_VISIT")).toBeFalsy();
  });
});
