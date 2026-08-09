// Critères d'acceptation — Fonctionnalités D2 de d1-d2.feature (ADR-018) :
// « Embauche et cycle du contrat », « Historisation & requête temporelle »,
// « Sortie et registre ». Traduction 1-pour-1 des scénarios 6→13.
import { describe, it, expect, beforeEach } from "vitest";
import { hrManager, tenantAdmin, signatory, buildDB, resetDb } from "../helpers.js";

// Contexte commun : tenant ACME, entité + établissement + 2 sites opérationnels.
async function ctx(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site Marseille" } });
  const establishmentId = e.json().id;
  const marseille = (await app.inject({ method: "POST", url: `/api/v1/establishments/${establishmentId}/operating-sites`, headers: hrManager(), payload: { name: "Site Marseille" } })).json().id;
  const aix = (await app.inject({ method: "POST", url: `/api/v1/establishments/${establishmentId}/operating-sites`, headers: hrManager(), payload: { name: "Site Aix" } })).json().id;
  return { companyId, establishmentId, marseille, aix };
}
const hire = (app: any, companyId: string, establishmentId: string, person: any, extra: any = {}) => app.inject({
  method: "POST", url: "/api/v1/employments", headers: hrManager(),
  payload: { person, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, startDate: "2026-09-01", contractType: "CDI", ...extra },
});

describe("Acceptation D2 — Embauche & cycle du contrat", () => {
  let app: any;
  beforeEach(async () => { await resetDb(); app = await buildDB(); });

  it("Sc.6 Embaucher crée la cascade Person/Employment(PRE_HIRE)/Contract(DRAFT)/Assignment + EmployeeHired", async () => {
    const { companyId, establishmentId, marseille } = await ctx(app);
    const res = await hire(app, companyId, establishmentId, { lastName: "Dupont", firstName: "Marie" }, { operatingSiteId: marseille });
    expect(res.statusCode).toBe(201);
    const b = res.json();
    expect(b.employment.personId).toBeTruthy();               // Person créée
    expect(b.employment.status).toBe("PRE_HIRE");
    expect(b.contract.status).toBe("DRAFT");
    expect(b.assignment.operatingSiteId).toBe(marseille);     // Assignment sur Site Marseille
    expect(app.bus.eventsOf("ACME", "EmployeeHired").length).toBe(1);
  });

  it("Sc.7 Détection de doublon sans fusion automatique → 409 + candidats", async () => {
    await app.inject({ method: "POST", url: "/api/v1/persons", headers: hrManager(), payload: { lastName: "Dupont", firstName: "Marie", birthDate: "1990-05-12" } });
    const dup = await app.inject({ method: "POST", url: "/api/v1/persons", headers: hrManager(), payload: { lastName: "Dupont", firstName: "Marie", birthDate: "1990-05-12" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().details.candidates.length).toBeGreaterThanOrEqual(1); // candidats listés, aucune fusion
  });

  it("Sc.8 Séparation création/signature : RH ne signe pas (403), le signataire signe (200) → SIGNED puis ACTIVE", async () => {
    const { companyId, establishmentId } = await ctx(app);
    const contractId = (await hire(app, companyId, establishmentId, { lastName: "Dupont", firstName: "Marie" })).json().contract.id;
    // RH (HrManager) n'a pas contract.sign
    expect((await app.inject({ method: "POST", url: `/api/v1/contracts/${contractId}/sign`, headers: hrManager() })).statusCode).toBe(403);
    // Le signataire (dg) signe
    const signed = await app.inject({ method: "POST", url: `/api/v1/contracts/${contractId}/sign`, headers: signatory() });
    expect(signed.statusCode).toBe(200);
    expect(signed.json().status).toBe("ACTIVE");
    const types = app.bus.eventsOf("ACME").map((e: any) => e.type);
    expect(types).toContain("ContractSigned");
    expect(types).toContain("ContractActivated");
  });

  it("Sc.9 Un contrat signé n'est pas modifié en silence : avenant + historique conservé", async () => {
    const { companyId, establishmentId } = await ctx(app);
    const contractId = (await hire(app, companyId, establishmentId, { lastName: "Dupont", firstName: "Marie" }, { grossMonthly: 2000 })).json().contract.id;
    await app.inject({ method: "POST", url: `/api/v1/contracts/${contractId}/sign`, headers: signatory() });
    const am = await app.inject({ method: "POST", url: `/api/v1/contracts/${contractId}/amendments`, headers: hrManager(), payload: { subject: "Passage à 39h", effectiveDate: "2026-12-01", changes: { workingTime: 39 } } });
    expect(am.statusCode).toBe(201);
    expect(app.bus.eventsOf("ACME", "AmendmentCreated").length).toBe(1);
    // l'avenant est conservé comme historique (consultable)
    const list = await app.inject({ method: "GET", url: `/api/v1/contracts/${contractId}/amendments`, headers: hrManager() });
    expect(list.json().length).toBe(1);
  });
});

describe("Acceptation D2 — Historisation & requête temporelle", () => {
  let app: any;
  beforeEach(async () => { await resetDb(); app = await buildDB(); });

  it("Sc.10 employee360?asOf= reconstruit l'affectation passée puis future", async () => {
    const { companyId, establishmentId, marseille, aix } = await ctx(app);
    const employmentId = (await hire(app, companyId, establishmentId, { lastName: "Dupont", firstName: "Marie" }, { operatingSiteId: marseille })).json().employment.id;
    // mobilité vers Aix au 2026-10-01
    await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/assignments`, headers: hrManager(), payload: { operatingSiteId: aix, validFrom: "2026-10-01" } });

    const at = (d: string) => app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/employee360?asOf=${d}`, headers: hrManager() });
    expect((await at("2026-09-15")).json().currentAssignment.operatingSiteId).toBe(marseille);
    expect((await at("2026-10-15")).json().currentAssignment.operatingSiteId).toBe(aix);
  });

  it("Sc.11 une mobilité ne détruit pas l'historique (ancienne affectation clôturée, conservée)", async () => {
    const { companyId, establishmentId, marseille, aix } = await ctx(app);
    const employmentId = (await hire(app, companyId, establishmentId, { lastName: "Dupont", firstName: "Marie" }, { operatingSiteId: marseille })).json().employment.id;
    await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/assignments`, headers: hrManager(), payload: { operatingSiteId: aix, validFrom: "2026-10-01" } });
    // L'ancienne affectation reste CONSULTABLE via requête temporelle et est clôturée
    // au 2026-09-30 (la veille du transfert) — prouvé sans accès au store interne.
    const at = async (d: string) => (await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/employee360?asOf=${d}`, headers: hrManager() })).json().currentAssignment?.operatingSiteId;
    expect(await at("2026-09-30")).toBe(marseille); // ancienne encore valide la veille
    expect(await at("2026-10-01")).toBe(aix);       // nouvelle à partir du transfert
    expect(await at("2026-09-15")).toBe(marseille); // historique préservé
  });
});

describe("Acceptation D2 — Sortie et registre", () => {
  let app: any;
  beforeEach(async () => { await resetDb(); app = await buildDB(); });

  it("Sc.12 déclarer une sortie future → EXITING, émet EmployeeDeparture, dossier consultable", async () => {
    const { companyId, establishmentId } = await ctx(app);
    const employmentId = (await hire(app, companyId, establishmentId, { lastName: "Dupont", firstName: "Marie" })).json().employment.id;
    const dep = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/departure`, headers: signatory(), payload: { endDate: "2027-03-31", reason: "démission" } });
    expect(dep.statusCode).toBe(200);
    expect(dep.json().status).toBe("EXITING"); // sortie future
    expect(app.bus.eventsOf("ACME", "EmployeeDeparture").length).toBe(1);
    // dossier toujours consultable (jamais supprimé)
    expect((await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/employee360`, headers: hrManager() })).statusCode).toBe(200);
  });

  it("Sc.13 le RUP est généré depuis les données structurées (3 lignes cohérentes)", async () => {
    const { companyId, establishmentId } = await ctx(app);
    for (const n of ["Un", "Deux", "Trois"]) await hire(app, companyId, establishmentId, { lastName: n, firstName: "X" });
    const reg = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/registry`, headers: hrManager() });
    const rows = reg.json();
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.lastName).toBeTruthy();
      expect(r.establishmentSiret).toBe("55210055400013");
      expect(r.contractType).toBe("CDI");
      expect(r.startDate).toBe("2026-09-01");
    }
  });
});
