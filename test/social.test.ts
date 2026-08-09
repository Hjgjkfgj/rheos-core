import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, employee, tenantAdmin } from "./helpers.js";

async function base(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site" } });
  const h = await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: "Élu", firstName: "Paul" }, legalEntityId: companyId, administrativeEstablishmentId: e.json().id, startDate: "2026-01-01", contractType: "CDI" } });
  return { companyId, employmentId: h.json().employment.id };
}

describe("Dialogue social / CSE (D8)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("crée un mandat et le liste avec le nom du collaborateur", async () => {
    const { companyId, employmentId } = await base(app);
    const m = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/cse/mandates`, headers: hrManager(), payload: { employmentId, role: "TITULAIRE", startDate: "2026-02-01" } });
    expect(m.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/cse/mandates`, headers: hrManager() });
    expect(list.json().length).toBe(1);
    expect(list.json()[0].name).toBe("Paul Élu");
    expect(list.json()[0].role).toBe("TITULAIRE");
  });

  it("planifie une réunion puis enregistre le PV (statut HELD)", async () => {
    const { companyId } = await base(app);
    const mtg = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/cse/meetings`, headers: hrManager(), payload: { date: "2026-03-15", type: "ORDINAIRE", agenda: ["Budget ASC", "Conditions de travail"] } });
    expect(mtg.statusCode).toBe(201);
    expect(mtg.json().status).toBe("PLANNED");
    const held = await app.inject({ method: "POST", url: `/api/v1/cse/meetings/${mtg.json().id}/minutes`, headers: hrManager(), payload: { minutes: "Décisions prises: ..." } });
    expect(held.json().status).toBe("HELD");
    expect(held.json().minutes).toContain("Décisions");
    const meetings = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/cse/meetings`, headers: hrManager() });
    expect(meetings.json().length).toBe(1);
  });

  it("un collaborateur ne peut pas créer de mandat → 403", async () => {
    const { companyId, employmentId } = await base(app);
    const m = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/cse/mandates`, headers: employee(), payload: { employmentId, role: "TITULAIRE", startDate: "2026-02-01" } });
    expect(m.statusCode).toBe(403);
  });

  it("NAO : ouvre une négociation puis conclut par un accord", async () => {
    const { companyId } = await base(app);
    const n = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/negotiations`, headers: hrManager(), payload: { year: 2026, theme: "SALAIRES", startDate: "2026-01-15" } });
    expect(n.statusCode).toBe(201);
    expect(n.json().status).toBe("PLANNED");
    const upd = await app.inject({ method: "POST", url: `/api/v1/negotiations/${n.json().id}/status`, headers: hrManager(), payload: { status: "AGREEMENT", notes: "Accord +2%" } });
    expect(upd.json().status).toBe("AGREEMENT");
    const list = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/negotiations`, headers: hrManager() });
    expect(list.json().length).toBe(1);
  });
});
