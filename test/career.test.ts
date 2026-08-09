import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, employee, tenantAdmin } from "./helpers.js";

const iso = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

async function hire(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site" } });
  const h = await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: "Talent", firstName: "Lea" }, legalEntityId: companyId, administrativeEstablishmentId: e.json().id, startDate: "2026-01-01", contractType: "CDI" } });
  return { companyId, employmentId: h.json().employment.id };
}

describe("Carrière, Compétences & Formation (D7)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("compétence avec expiration → habilitation en veille", async () => {
    const { companyId, employmentId } = await hire(app);
    const c = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/competencies`, headers: hrManager(), payload: { name: "CACES R489", level: "ADVANCED", expiresAt: iso(20) } });
    expect(c.statusCode).toBe(201);
    const dl = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/deadlines`, headers: hrManager() });
    expect(dl.json().items.find((i: any) => i.type === "HABILITATION")).toBeTruthy();
  });

  it("planifie puis complète une formation", async () => {
    const { companyId, employmentId } = await hire(app);
    const t = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/trainings`, headers: hrManager(), payload: { title: "Sécurité incendie", type: "SAFETY", dueDate: iso(30) } });
    expect(t.json().status).toBe("PLANNED");
    const done = await app.inject({ method: "POST", url: `/api/v1/trainings/${t.json().id}/complete`, headers: hrManager(), payload: { date: "2026-02-10" } });
    expect(done.json().status).toBe("DONE");
    const list = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/trainings`, headers: hrManager() });
    expect(list.json().length).toBe(1);
  });

  it("entretien : planifié puis tenu", async () => {
    const { employmentId } = await hire(app);
    const r = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/reviews`, headers: hrManager(), payload: { type: "ANNUAL", date: "2026-06-01" } });
    expect(r.json().status).toBe("PLANNED");
    const held = await app.inject({ method: "POST", url: `/api/v1/reviews/${r.json().id}/hold`, headers: hrManager(), payload: { notes: "Objectifs 2027 fixés" } });
    expect(held.json().status).toBe("HELD");
    expect(held.json().notes).toContain("Objectifs");
  });

  it("un collaborateur ne peut pas ajouter une compétence → 403", async () => {
    const { employmentId } = await hire(app);
    const c = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/competencies`, headers: employee(), payload: { name: "X", level: "BEGINNER" } });
    expect(c.statusCode).toBe(403);
  });
});
