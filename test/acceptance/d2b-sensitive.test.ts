// D2b (Lot 11) — Confidentialité des données sensibles + change requests.
// Traduit les scénarios Gherkin 14-15 de d1-d2.feature et tourne dans les DEUX
// stores (mémoire + STORE=prisma via buildDB/resetDb).
import { describe, it, expect, beforeEach } from "vitest";
import { hrManager, tenantAdmin, manager, buildDB, resetDb } from "../helpers.js";
import { signToken } from "../../src/jwt.js";

const payroll = () => ({ authorization: `Bearer ${signToken({ sub: "paie", tenantId: "ACME", roles: ["PayrollOfficer"] })}` });
const asMe = (personId: string) => ({ authorization: `Bearer ${signToken({ sub: "me", tenantId: "ACME", personId, roles: ["Employee"] })}` });

async function setup(app: any) {
  const co = (await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } })).json();
  const est = (await app.inject({ method: "POST", url: `/api/v1/companies/${co.id}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Établissement Marseille" } })).json();
  const hire = (await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: "Dupont", firstName: "Marie" }, legalEntityId: co.id, administrativeEstablishmentId: est.id, startDate: "2026-01-01", contractType: "CDI" } })).json();
  const bank = (await app.inject({ method: "POST", url: `/api/v1/persons/${hire.employment.personId}/bank-accounts`, headers: hrManager(), payload: { iban: "FR7630004000031234567890143", bic: "BNPAFRPP" } })).json();
  return { companyId: co.id, personId: hire.employment.personId, employmentId: hire.employment.id, bankId: bank.id };
}

describe("D2b — Confidentialité des données sensibles (scénarios 14-15)", () => {
  let app: any;
  beforeEach(async () => { await resetDb(); app = await buildDB(); });

  it("Sc.14 : les coordonnées bancaires ne sont pas exposées sans droit", async () => {
    const { personId, employmentId, bankId } = await setup(app);
    // affichage MASQUÉ par défaut (ibanLast4) — jamais l'IBAN complet ni le chiffré
    const list = (await app.inject({ method: "GET", url: `/api/v1/persons/${personId}/bank-accounts`, headers: payroll() })).json();
    expect(list[0].ibanLast4).toBe("0143");
    expect(list[0].ibanEnc).toBeUndefined();
    expect(JSON.stringify(list)).not.toContain("FR76");
    // employee360 (Manager) ne contient AUCUNE coordonnée bancaire
    const e360 = (await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/employee360`, headers: manager() })).json();
    expect(JSON.stringify(e360)).not.toMatch(/iban/i);
    expect(e360.bankAccount).toBeUndefined();
    // accès direct aux coordonnées bancaires par un rôle non habilité → 403
    expect((await app.inject({ method: "GET", url: `/api/v1/bank-accounts/${bankId}/iban`, headers: manager() })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/api/v1/persons/${personId}/bank-accounts`, headers: manager() })).statusCode).toBe(403);
  });

  it("Sc.15 : une lecture d'IBAN complet est journalisée (qui/quoi)", async () => {
    const { bankId } = await setup(app);
    const read = await app.inject({ method: "GET", url: `/api/v1/bank-accounts/${bankId}/iban`, headers: payroll() });
    expect(read.statusCode).toBe(200);
    expect(read.json().iban).toBe("FR7630004000031234567890143"); // déchiffré pour un rôle habilité
    // trace d'audit visible (rôle audit.read)
    const audit = (await app.inject({ method: "GET", url: "/api/v1/audit", headers: tenantAdmin() })).json();
    const entry = audit.find((a: any) => a.action === "bank_account.read.iban" && a.entityId === bankId);
    expect(entry).toBeTruthy();
    expect(entry.userId).toBe("paie"); // QUI a lu
  });

  it("lecture d'un NIR : chiffré au repos, déchiffré uniquement pour un rôle habilité, et journalisée", async () => {
    const { personId } = await setup(app);
    const sid = (await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/sensitive-ids`, headers: hrManager(), payload: { type: "NIR", value: "190051300104212" } })).json();
    // Manager (sans person.sensitive.read) → 403
    expect((await app.inject({ method: "GET", url: `/api/v1/sensitive-ids/${sid.id}/value`, headers: manager() })).statusCode).toBe(403);
    // PayrollOfficer (habilité) → valeur + audit
    const v = await app.inject({ method: "GET", url: `/api/v1/sensitive-ids/${sid.id}/value`, headers: payroll() });
    expect(v.json().value).toBe("190051300104212");
    const audit = (await app.inject({ method: "GET", url: "/api/v1/audit", headers: tenantAdmin() })).json();
    expect(audit.some((a: any) => a.action === "person.sensitive.read" && a.entityId === sid.id)).toBe(true);
  });

  it("IDOR : un collaborateur ne lit pas l'IBAN d'un autre (scopé au jeton) → 404", async () => {
    const { bankId } = await setup(app);
    // employé dont le personId ne correspond pas au titulaire → 404
    const res = await app.inject({ method: "GET", url: `/api/v1/bank-accounts/${bankId}/iban`, headers: asMe("intrus") });
    expect(res.statusCode).toBe(404);
  });
});

describe("D2b — Change requests self-service (Tome 08 §2.44)", () => {
  let app: any;
  beforeEach(async () => { await resetDb(); app = await buildDB(); });

  it("REQUEST → VALIDATION RH → UPDATE : le collaborateur ne modifie jamais directement", async () => {
    const { personId } = await setup(app);
    // le collaborateur SOUMET une demande de changement d'adresse (jamais d'UPDATE direct)
    const cr = await app.inject({ method: "POST", url: "/api/v1/me/change-requests", headers: asMe(personId), payload: { field: "address", value: { line1: "10 rue Neuve", postalCode: "13002", city: "Marseille" } } });
    expect(cr.statusCode).toBe(201);
    expect(cr.json().status).toBe("REQUESTED");
    // il voit le statut de sa demande
    expect((await app.inject({ method: "GET", url: "/api/v1/me/change-requests", headers: asMe(personId) })).json()[0].status).toBe("REQUESTED");
    // les RH voient la demande en attente et la VALIDENT → l'adresse est appliquée (SCD-2)
    const pending = (await app.inject({ method: "GET", url: "/api/v1/change-requests/pending", headers: hrManager() })).json();
    expect(pending.length).toBe(1);
    const decided = await app.inject({ method: "POST", url: `/api/v1/change-requests/${cr.json().id}/approve`, headers: hrManager() });
    expect(decided.json().status).toBe("APPROVED");
    const addresses = (await app.inject({ method: "GET", url: `/api/v1/persons/${personId}/addresses`, headers: hrManager() })).json();
    expect(addresses.find((a: any) => a.city === "Marseille" && a.postalCode === "13002")).toBeTruthy();
    // événement de changement d'adresse émis
    expect(app.bus.eventsOf("ACME", "AddressChanged").length).toBe(1);
  });

  it("refus motivé possible", async () => {
    const { personId } = await setup(app);
    const cr = await app.inject({ method: "POST", url: "/api/v1/me/change-requests", headers: asMe(personId), payload: { field: "address", value: { line1: "x", postalCode: "13001", city: "Marseille" } } });
    const refused = await app.inject({ method: "POST", url: `/api/v1/change-requests/${cr.json().id}/refuse`, headers: hrManager(), payload: { reason: "justificatif manquant" } });
    expect(refused.json().status).toBe("REFUSED");
    expect(refused.json().reason).toBe("justificatif manquant");
  });

  it("un collaborateur ne peut pas valider une demande (deny by default) → 403", async () => {
    const { personId } = await setup(app);
    const cr = await app.inject({ method: "POST", url: "/api/v1/me/change-requests", headers: asMe(personId), payload: { field: "address", value: { line1: "x", postalCode: "13001", city: "Marseille" } } });
    expect((await app.inject({ method: "POST", url: `/api/v1/change-requests/${cr.json().id}/approve`, headers: asMe(personId) })).statusCode).toBe(403);
  });
});
