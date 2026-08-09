// D2 — Dossier collaborateur (Tome 08 + openapi.yaml). Au-delà des scénarios
// Gherkin : séparation stricte création/validation/signature, cycle de sortie
// (clôture affectations, EXITING→ENDED→ARCHIVED, réactivation = nouvel Employment),
// RUP reflétant entrée/évolution/sortie sans stockage propre.
import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, tenantAdmin, signatory, employee } from "./helpers.js";

async function ctx(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site Marseille" } });
  return { companyId, establishmentId: e.json().id };
}
const hire = (app: any, companyId: string, establishmentId: string, person: any, extra: any = {}) => app.inject({
  method: "POST", url: "/api/v1/employments", headers: hrManager(),
  payload: { person, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, startDate: "2026-09-01", contractType: "CDI", ...extra },
});

describe("D2 — Séparation création / validation / signature", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("trois verbes distincts : HrOfficer crée, HrManager valide, Signatory signe", async () => {
    const { companyId, establishmentId } = await ctx(app);
    const employmentId = (await hire(app, companyId, establishmentId, { lastName: "Dupont", firstName: "Marie" })).json().employment.id;

    // Création autonome d'un second contrat (contract.create) — HrOfficer
    const officer = { authorization: `Bearer ${(await import("../src/jwt.js")).signToken({ sub: "off", tenantId: "ACME", roles: ["HrOfficer"] })}` };
    const created = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/contracts`, headers: officer, payload: { type: "CDD", startDate: "2027-01-01" } });
    expect(created.statusCode).toBe(201);
    const contractId = created.json().id;

    // HrOfficer NE valide PAS (pas de contract.validate)
    expect((await app.inject({ method: "POST", url: `/api/v1/contracts/${contractId}/validate`, headers: officer })).statusCode).toBe(403);
    // HrManager valide (contract.validate)
    const validated = await app.inject({ method: "POST", url: `/api/v1/contracts/${contractId}/validate`, headers: hrManager() });
    expect(validated.statusCode).toBe(200);
    expect(validated.json().status).toBe("VALIDATED");
    // HrManager NE signe PAS ; le Signatory signe
    expect((await app.inject({ method: "POST", url: `/api/v1/contracts/${contractId}/sign`, headers: hrManager() })).statusCode).toBe(403);
    const signed = await app.inject({ method: "POST", url: `/api/v1/contracts/${contractId}/sign`, headers: signatory() });
    expect(signed.json().status).toBe("ACTIVE");
    expect(app.bus.eventsOf("ACME", "ContractValidated").length).toBe(1);
  });
});

describe("D2 — Sortie : clôture, archivage, réactivation", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("une sortie passée clôture les affectations ouvertes (validTo = date d'effet) et passe ENDED", async () => {
    const { companyId, establishmentId } = await ctx(app);
    // embauche début 2026, sortie passée (aujourd'hui = 2026-08-09)
    const employmentId = (await hire(app, companyId, establishmentId, { lastName: "Dupont", firstName: "Marie" }, { startDate: "2026-01-01" })).json().employment.id;
    const dep = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/departure`, headers: signatory(), payload: { endDate: "2026-06-30", reason: "fin période essai" } });
    expect(dep.json().status).toBe("ENDED"); // date passée → ENDED
    const asg = app.db.assignments.filter((a: any) => a.employmentId === employmentId);
    expect(asg.every((a: any) => a.validTo === "2026-06-30")).toBe(true); // affectations clôturées
    expect(app.bus.eventsOf("ACME", "EmployeeDeparture")[0].payload.accessRevoked).toBe(true);
  });

  it("EXITING→ENDED→ARCHIVED ; l'archivage exige d'être ENDED ; jamais de suppression", async () => {
    const { companyId, establishmentId } = await ctx(app);
    const employmentId = (await hire(app, companyId, establishmentId, { lastName: "Dupont", firstName: "Marie" }, { startDate: "2026-01-01" })).json().employment.id;
    // archivage refusé tant qu'on n'est pas ENDED
    expect((await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/archive`, headers: signatory() })).statusCode).toBe(409);
    await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/departure`, headers: signatory(), payload: { endDate: "2026-06-30", reason: "x" } });
    const archived = await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/archive`, headers: signatory() });
    expect(archived.json().status).toBe("ARCHIVED");
    // toujours consultable après archivage
    expect((await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/employee360`, headers: hrManager() })).statusCode).toBe(200);
  });

  it("réembaucher une personne sortie crée un NOUVEL Employment (jamais un doublon de Person)", async () => {
    const { companyId, establishmentId } = await ctx(app);
    const first = (await hire(app, companyId, establishmentId, { lastName: "Dupont", firstName: "Marie" })).json();
    const personId = first.employment.personId;
    await app.inject({ method: "POST", url: `/api/v1/employments/${first.employment.id}/departure`, headers: signatory(), payload: { endDate: "2026-09-30", reason: "x" } });
    // réembauche en réutilisant la Person existante
    const second = await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { personId, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, startDate: "2027-01-01", contractType: "CDI" } });
    expect(second.statusCode).toBe(201);
    expect(second.json().employment.personId).toBe(personId);     // même personne
    expect(second.json().employment.id).not.toBe(first.employment.id); // nouvel Employment
    expect(app.db.persons.filter((p: any) => p.id === personId).length).toBe(1); // pas de doublon Person
    expect(app.db.employments.filter((e: any) => e.personId === personId).length).toBe(2);
  });
});

describe("D2 — RUP : projection entrée / évolution / sortie (sans base parallèle)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("le registre reflète l'entrée, l'évolution (avenant appliqué) et la sortie", async () => {
    const { companyId, establishmentId } = await ctx(app);
    const h = (await hire(app, companyId, establishmentId, { lastName: "Dupont", firstName: "Marie" }, { startDate: "2026-01-01", grossMonthly: 2000 })).json();
    // évolution : avenant signé qui modifie la classification du contrat
    await app.inject({ method: "POST", url: `/api/v1/contracts/${h.contract.id}/sign`, headers: signatory() });
    const am = await app.inject({ method: "POST", url: `/api/v1/contracts/${h.contract.id}/amendments`, headers: hrManager(), payload: { subject: "Promotion", effectiveDate: "2026-03-01", changes: { classification: "Agent de maîtrise" } } });
    await app.inject({ method: "POST", url: `/api/v1/amendments/${am.json().id}/sign`, headers: signatory() });

    // entrée + évolution reflétées
    let reg = (await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/registry`, headers: hrManager() })).json();
    expect(reg[0].startDate).toBe("2026-01-01");
    expect(reg[0].classification).toBe("Agent de maîtrise"); // évolution via avenant, pas de base parallèle
    expect(reg[0].status).toBe("ACTIVE");

    // sortie reflétée dynamiquement
    await app.inject({ method: "POST", url: `/api/v1/employments/${h.employment.id}/departure`, headers: signatory(), payload: { endDate: "2026-06-30", reason: "x" } });
    reg = (await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/registry`, headers: hrManager() })).json();
    expect(reg[0].endDate).toBe("2026-06-30");
    expect(reg[0].status).toBe("ENDED");
  });

  it("un RUP par établissement (filtre establishmentId)", async () => {
    const { companyId, establishmentId } = await ctx(app);
    const e2 = (await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400021", name: "Site Lyon" } })).json().id;
    await hire(app, companyId, establishmentId, { lastName: "Marseille", firstName: "A" });
    await hire(app, companyId, e2, { lastName: "Lyon", firstName: "B" });
    const regEtab1 = (await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/registry?establishmentId=${establishmentId}`, headers: hrManager() })).json();
    expect(regEtab1.length).toBe(1);
    expect(regEtab1[0].lastName).toBe("Marseille");
  });
});
