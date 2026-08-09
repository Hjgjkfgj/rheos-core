// D1 — Entreprise & Référentiel (Tome 07 + openapi.yaml). Fonctionnalités hors
// scénarios Gherkin de base : fermeture d'établissement (historique, jamais de
// suppression), listes, convention datée, cycle de vie d'obligation, effectif
// historisé, minimum conventionnel à la DATE D'EFFET.
import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, tenantAdmin, signatory } from "./helpers.js";

async function company(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site Marseille", idcc: "2216" } });
  return { companyId, establishmentId: e.json().id };
}

describe("D1 — Établissements : fermeture avec historique", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("fermer un établissement : statut CLOSED, historique conservé, EstablishmentClosed, jamais supprimé", async () => {
    const { companyId, establishmentId } = await company(app);
    const res = await app.inject({ method: "POST", url: `/api/v1/establishments/${establishmentId}/close`, headers: hrManager(), payload: { closureDate: "2027-01-31", reason: "regroupement" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("CLOSED");
    expect(res.json().closureDate).toBe("2027-01-31");
    // toujours consultable (jamais de suppression)
    const list = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager() });
    expect(list.json().find((e: any) => e.id === establishmentId)?.status).toBe("CLOSED");
    expect(app.bus.eventsOf("ACME", "EstablishmentClosed").length).toBe(1);
  });

  it("fermeture idempotente : deuxième appel n'émet pas un nouvel événement", async () => {
    const { establishmentId } = await company(app);
    await app.inject({ method: "POST", url: `/api/v1/establishments/${establishmentId}/close`, headers: hrManager(), payload: { closureDate: "2027-01-31" } });
    await app.inject({ method: "POST", url: `/api/v1/establishments/${establishmentId}/close`, headers: hrManager(), payload: { closureDate: "2027-02-28" } });
    expect(app.bus.eventsOf("ACME", "EstablishmentClosed").length).toBe(1);
  });

  it("la fermeture exige la permission establishment.close (Signatory refusé)", async () => {
    const { establishmentId } = await company(app);
    const res = await app.inject({ method: "POST", url: `/api/v1/establishments/${establishmentId}/close`, headers: signatory(), payload: { closureDate: "2027-01-31" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("D1 — Listes, postes, convention datée", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("GET /companies liste (paginée) uniquement les entités du tenant", async () => {
    await company(app);
    const list = await app.inject({ method: "GET", url: "/api/v1/companies", headers: tenantAdmin() });
    expect(list.json().total).toBe(1);
    expect(list.json().items.length).toBe(1);
    expect(list.json().page).toBe(1);
    // isolation : un autre tenant ne voit rien
    const other = await app.inject({ method: "GET", url: "/api/v1/companies", headers: tenantAdmin("BETA") });
    expect(other.json().total).toBe(0);
  });

  it("rattacher une convention datée émet AgreementLinked et l'historise", async () => {
    const { companyId } = await company(app);
    const res = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/agreements`, headers: hrManager(), payload: { type: "COLLECTIVE", idcc: "2216", title: "Commerce de détail alimentaire", source: "IDCC 2216", effectiveFrom: "2024-01-01" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().effectiveFrom).toBe("2024-01-01");
    expect(app.bus.eventsOf("ACME", "AgreementLinked").length).toBe(1);
    const list = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/agreements`, headers: hrManager() });
    expect(list.json()[0].idcc).toBe("2216");
  });

  it("POST /positions émet PositionCreated", async () => {
    const { companyId } = await company(app);
    const res = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/positions`, headers: hrManager(), payload: { title: "Vendeur", coefficient: 130 } });
    expect(res.statusCode).toBe(201);
    expect(app.bus.eventsOf("ACME", "PositionCreated").length).toBe(1);
  });
});

describe("D1 — Cycle de vie d'une obligation (DETECTED→…→ARCHIVED)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("avance l'obligation par transitions valides jusqu'à ARCHIVED, refuse les sauts", async () => {
    const { companyId, establishmentId } = await company(app);
    for (let i = 0; i < 11; i++) {
      await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: `N${i}`, firstName: "X" }, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, startDate: "2026-01-01", contractType: "CDI" } });
    }
    const obs = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/obligations`, headers: hrManager() });
    const cse = obs.json().find((o: any) => o.code === "CSE_ELECTION");
    expect(cse.status).toBe("DETECTED");

    // saut invalide DETECTED → COMPLETED refusé
    const bad = await app.inject({ method: "POST", url: `/api/v1/obligations/${cse.id}/status`, headers: hrManager(), payload: { status: "COMPLETED" } });
    expect(bad.statusCode).toBe(409);

    // chemin valide complet
    for (const to of ["QUALIFIED", "ACTIVE", "IN_PROGRESS", "COMPLETED", "ARCHIVED"]) {
      const r = await app.inject({ method: "POST", url: `/api/v1/obligations/${cse.id}/status`, headers: hrManager(), payload: { status: to } });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe(to);
    }
    expect(app.bus.eventsOf("ACME", "ObligationStatusChanged").length).toBe(5);
  });
});

describe("D1 — Effectif historisé + minimum conventionnel à la date d'effet", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("chaque embauche persiste un WorkforceSnapshot calculé", async () => {
    const { companyId, establishmentId } = await company(app);
    await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: "Dupont", firstName: "Marie" }, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, startDate: "2026-01-01", contractType: "CDI" } });
    const snaps = app.db.workforceSnapshots.filter((s: any) => s.legalEntityId === companyId);
    expect(snaps.length).toBe(1);
    expect(snaps[0].headcount).toBe(1);
    expect(snaps[0].method).toBe("HEADCOUNT_ACTIVE");
  });

  it("minimum conventionnel évalué À LA DATE D'EFFET (valeur du point datée 2216)", async () => {
    // IDCC 2216 : valeur du point 20.0 (dès 2024) puis 20.5 (dès 2026).
    // Coef 130 = 95 points → minimum 1900 € (avant 2026), 1947,50 € (dès 2026).
    const { companyId, establishmentId } = await company(app);
    const pos = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/positions`, headers: hrManager(), payload: { title: "Employé polyvalent", coefficient: 130 } });
    const positionId = pos.json().id;
    const hire = (startDate: string, gross: number) => app.inject({
      method: "POST", url: "/api/v1/employments", headers: hrManager(),
      payload: { person: { lastName: "Test", firstName: startDate }, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, positionId, startDate, contractType: "CDI", grossMonthly: gross },
    });

    // 1920 € : ACCEPTÉ au 2025-06-01 (min 1900), REFUSÉ au 2026-06-01 (min 1947,50)
    const before = await hire("2025-06-01", 1920);
    expect(before.statusCode).toBe(201);
    const after = await hire("2026-06-01", 1920);
    expect(after.statusCode).toBe(409);
    expect(after.json().code).toBe("below_convention_minimum");
  });
});
