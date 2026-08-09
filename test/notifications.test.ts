import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, signatory, manager, employee, tenantAdmin } from "./helpers.js";

describe("Centre de notifications / alertes", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("agrège et priorise les actions en attente", async () => {
    // société + établissement
    const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
    const companyId = c.json().id;
    const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site" } });
    const establishmentId = e.json().id;

    // 11 embauches → obligation CSE (IMPORTANT) + 11 contrats DRAFT (ACTION)
    let firstEmp = "";
    for (let i = 0; i < 11; i++) {
      const h = await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: `N${i}`, firstName: "X" }, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, startDate: "2026-01-01", contractType: "CDI" } });
      if (i === 0) firstEmp = h.json().employment.id;
    }

    // une demande de congé (ACTION)
    await app.inject({ method: "POST", url: `/api/v1/employments/${firstEmp}/leave-requests`, headers: employee(), payload: { type: "PAID", startDate: "2026-06-01", endDate: "2026-06-03" } });

    // un document en attente de signature (ACTION) — via le personId du collaborateur
    const emp360 = await app.inject({ method: "GET", url: `/api/v1/employments/${firstEmp}/employee360`, headers: hrManager() });
    const personId = emp360.json().person.id;
    const dep = await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/documents`, headers: hrManager(), payload: { type: "CONTRACT", label: "Contrat", content: "abc" } });
    await app.inject({ method: "POST", url: `/api/v1/documents/${dep.json().id}/signature/request`, headers: hrManager() });

    // une sortie (IMPORTANT)
    await app.inject({ method: "POST", url: `/api/v1/employments/${firstEmp}/departure`, headers: signatory(), payload: { endDate: "2027-01-01", reason: "démission" } });

    const res = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: hrManager() });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const cats = body.items.map((i: any) => i.category);
    expect(cats).toContain("obligation");
    expect(cats).toContain("contract");
    expect(cats).toContain("leave");
    expect(cats).toContain("document");
    expect(cats).toContain("departure");

    // priorisation : le 1er élément est au moins aussi prioritaire que le dernier
    const rank: any = { CRITICAL: 0, IMPORTANT: 1, ACTION: 2, INFO: 3 };
    expect(rank[body.items[0].severity]).toBeLessThanOrEqual(rank[body.items[body.items.length - 1].severity]);
    expect(body.counts.IMPORTANT).toBeGreaterThanOrEqual(1);
    expect(body.counts.ACTION).toBeGreaterThanOrEqual(1);
  });

  it("un collaborateur n'a pas accès au centre de notifications → 403", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: employee() });
    expect(res.statusCode).toBe(403);
  });

  it("isolation : ne remonte que les alertes du tenant", async () => {
    // BETA crée une société + embauche → BETA a des alertes
    const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin("BETA"), payload: { legalName: "BETA", siren: "111111111" } });
    await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager("BETA"), payload: { person: { lastName: "B", firstName: "X" }, legalEntityId: c.json().id, startDate: "2026-01-01", contractType: "CDI" } });

    // ACME n'a rien
    const res = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: hrManager("ACME") });
    expect(res.json().items.length).toBe(0);
  });
});
