import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { signToken } from "../src/jwt.js";
import { hrManager, signatory, manager, tenantAdmin } from "./helpers.js";

const asEmployee = (personId: string, tenantId = "ACME") => ({ authorization: `Bearer ${signToken({ sub: "me", tenantId, roles: ["Employee"], personId })}` });

async function hireOne(app: any, lastName = "Dupont") {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site" } });
  const h = await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName, firstName: "Marie" }, legalEntityId: companyId, administrativeEstablishmentId: e.json().id, startDate: "2026-09-01", contractType: "CDI", grossMonthly: 2000, workingTime: 35 } });
  return { companyId, employmentId: h.json().employment.id, personId: h.json().employment.personId, contractId: h.json().contract.id };
}

describe("Espace collaborateur (/me)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("renvoie uniquement mes données + progression d'intégration", async () => {
    const { personId, contractId } = await hireOne(app);
    await app.inject({ method: "POST", url: `/api/v1/contracts/${contractId}/sign`, headers: signatory() });

    const res = await app.inject({ method: "GET", url: "/api/v1/me", headers: asEmployee(personId) });
    expect(res.statusCode).toBe(200);
    const me = res.json();
    expect(me.greetingName).toBe("Marie");
    expect(me.contract.status).toBe("ACTIVE");
    expect(me.onboarding.percent).toBeGreaterThan(0);
    expect(me.onboarding.steps.find((s: any) => s.key === "contract").done).toBe(true);
  });

  it("un compte sans collaborateur (manager) → 403", async () => {
    await hireOne(app);
    const res = await app.inject({ method: "GET", url: "/api/v1/me", headers: manager() });
    expect(res.statusCode).toBe(403);
  });

  it("je peux poser un congé et voir mon solde", async () => {
    const { personId } = await hireOne(app);
    const post = await app.inject({ method: "POST", url: "/api/v1/me/leaves", headers: asEmployee(personId), payload: { type: "PAID", startDate: "2026-12-01", endDate: "2026-12-05" } });
    expect(post.statusCode).toBe(201);
    const leaves = await app.inject({ method: "GET", url: "/api/v1/me/leaves", headers: asEmployee(personId) });
    expect(leaves.json().balance.remaining).toBe(30); // droit CP ouvrables ; la demande en cours n'entame pas le solde
    expect(leaves.json().leaves.length).toBe(1);
    expect(leaves.json().leaves[0].status).toBe("REQUESTED");
  });

  it("isolation : je ne vois que mon dossier", async () => {
    const a = await hireOne(app, "Alpha");
    // second collaborateur
    const h2 = await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: "Beta", firstName: "Paul" }, legalEntityId: a.companyId, startDate: "2026-09-01", contractType: "CDI" } });
    const meA = await app.inject({ method: "GET", url: "/api/v1/me", headers: asEmployee(a.personId) });
    expect(meA.json().person.lastName).toBe("Alpha");
    const meB = await app.inject({ method: "GET", url: "/api/v1/me", headers: asEmployee(h2.json().employment.personId) });
    expect(meB.json().person.lastName).toBe("Beta");
  });

  it("la page /espace est servie publiquement", async () => {
    const res = await app.inject({ method: "GET", url: "/espace" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Mon espace");
  });
});
