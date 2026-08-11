// Lot 17 — Droits des personnes (RGPD). Droit d'accès (JSON + PDF, journalisé,
// sensibles masqués) et anonymisation en fin de rétention (identité + documents).
import { describe, it, expect } from "vitest";
import { build } from "../src/app.js";
import { tenantAdmin, hrManager, signatory } from "./helpers.js";

async function hirePast(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site Marseille" } });
  const h = await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: "Dupont", firstName: "Marie", birthDate: "1990-05-12" }, legalEntityId: companyId, administrativeEstablishmentId: e.json().id, startDate: "2019-01-01", contractType: "CDI", grossMonthly: 2100 } });
  return { companyId, employmentId: h.json().employment.id, personId: h.json().employment.personId };
}

describe("Droit d'accès (RGPD art. 15)", () => {
  it("exporte les données d'une personne en JSON, journalisé", async () => {
    const app: any = build(); const { personId } = await hirePast(app);
    const res = await app.inject({ method: "GET", url: `/api/v1/persons/${personId}/access-request`, headers: hrManager() });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.subject.lastName).toBe("Dupont");
    expect(d.employments).toHaveLength(1);
    expect(d.employments[0].contracts).toHaveLength(1);
    expect(app.db.auditLog.some((a: any) => a.action === "person.access_request" && a.entityId === personId)).toBe(true);
    expect(app.bus.eventsOf("ACME", "PersonDataAccessRequested")).toHaveLength(1);
  });

  it("produit un PDF valide", async () => {
    const app: any = build(); const { personId } = await hirePast(app);
    const res = await app.inject({ method: "GET", url: `/api/v1/persons/${personId}/access-request?format=pdf`, headers: hrManager() });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.body.startsWith("%PDF-1.")).toBe(true);
    expect(res.body).toContain("%%EOF");
  });

  it("masque les données sensibles (aucun IBAN complet dans l'export)", async () => {
    const app: any = build(); const { personId } = await hirePast(app);
    await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/bank-accounts`, headers: hrManager(), payload: { iban: "FR7630004000031234567890143", holderName: "Marie Dupont" } });
    const d = (await app.inject({ method: "GET", url: `/api/v1/persons/${personId}/access-request`, headers: hrManager() })).json();
    expect(d.bankAccounts).toHaveLength(1);
    expect(d.bankAccounts[0].ibanMasque).toMatch(/\*\*\*\*/);
    expect(JSON.stringify(d)).not.toContain("FR7630004000031234567890143");
  });
});

describe("Anonymisation en fin de rétention", () => {
  it("refuse tant qu'une relation de travail est active", async () => {
    const app: any = build(); const { personId } = await hirePast(app);
    const res = await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/anonymize`, headers: tenantAdmin() });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("active_employment");
  });

  it("anonymise l'identité et les documents après la fin de la relation", async () => {
    const app: any = build(); const { personId, employmentId } = await hirePast(app);
    await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/documents`, headers: hrManager(), payload: { type: "CONTRACT", label: "Contrat", content: "x" } });
    await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/departure`, headers: signatory(), payload: { endDate: "2020-01-01", reason: "démission" } });

    const res = await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/anonymize`, headers: tenantAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.json().documents).toBe(1);

    const p = app.db.persons.find((x: any) => x.id === personId);
    expect(p.lastName).toBe("ANONYMISÉ");
    expect(p.birthDate).toBeUndefined();
    expect(app.db.documents.some((d: any) => d.label === "[anonymisé]")).toBe(true);
    expect(app.bus.eventsOf("ACME", "PersonAnonymized")).toHaveLength(1);
    expect(app.db.auditLog.some((a: any) => a.action === "person.anonymize")).toBe(true);
  });
});
