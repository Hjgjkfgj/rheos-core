import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, employee, tenantAdmin } from "./helpers.js";

async function company(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  return c.json().id;
}

describe("Santé, Sécurité & Prévention (D6)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("cote un risque DUERP (gravité × probabilité → niveau)", async () => {
    const companyId = await company(app);
    const r = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/risks`, headers: hrManager(), payload: { unit: "Entrepôt", hazard: "Chute de hauteur", gravity: 4, probability: 3, measures: "Garde-corps" } });
    expect(r.statusCode).toBe(201);
    expect(r.json().score).toBe(12);
    expect(r.json().level).toBe("HIGH");
  });

  it("synthèse DUERP par niveau + priorités", async () => {
    const companyId = await company(app);
    await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/risks`, headers: hrManager(), payload: { hazard: "Chute", gravity: 4, probability: 3 } });
    await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/risks`, headers: hrManager(), payload: { hazard: "Bruit", gravity: 2, probability: 1 } });
    const s = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/duerp`, headers: hrManager() });
    expect(s.json().total).toBe(2);
    expect(s.json().byLevel.HIGH).toBe(1);
    expect(s.json().byLevel.LOW).toBe(1);
    expect(s.json().priorities[0].hazard).toBe("Chute");
  });

  it("plan d'actions : passe un risque à CONTROLLED", async () => {
    const companyId = await company(app);
    const r = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/risks`, headers: hrManager(), payload: { hazard: "TMS", gravity: 3, probability: 3 } });
    const u = await app.inject({ method: "PATCH", url: `/api/v1/risks/${r.json().id}`, headers: hrManager(), payload: { actionPlan: "Rotation des postes", status: "CONTROLLED" } });
    expect(u.json().status).toBe("CONTROLLED");
  });

  it("accident grave → échéance de déclaration créée (veille)", async () => {
    const companyId = await company(app);
    await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/accidents`, headers: hrManager(), payload: { date: "2026-05-10", description: "Chute grave", severity: "SERIOUS", lostDays: 30 } });
    const dl = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/deadlines`, headers: hrManager() });
    expect(dl.json().items.find((i: any) => i.type === "ACCIDENT_DECLARATION")).toBeTruthy();
  });

  it("un collaborateur ne peut pas coter un risque → 403", async () => {
    const companyId = await company(app);
    const r = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/risks`, headers: employee(), payload: { hazard: "X", gravity: 1, probability: 1 } });
    expect(r.statusCode).toBe(403);
  });
});
