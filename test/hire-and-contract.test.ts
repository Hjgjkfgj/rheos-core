import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, signatory, tenantAdmin } from "./helpers.js";

async function setupCompany(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site Marseille" } });
  return { companyId, establishmentId: e.json().id };
}

describe("Embauche & cycle du contrat (D2)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("SIREN invalide → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "X", siren: "12AB" } });
    expect(res.statusCode).toBe(400);
  });

  it("SIREN en doublon → 400", async () => {
    await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "A", siren: "552100554" } });
    const res = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "B", siren: "552100554" } });
    expect(res.statusCode).toBe(400);
  });

  it("l'embauche crée la cascade attendue + événement EmployeeHired", async () => {
    const { companyId, establishmentId } = await setupCompany(app);
    const res = await app.inject({
      method: "POST", url: "/api/v1/employments", headers: hrManager(),
      payload: {
        person: { lastName: "Dupont", firstName: "Marie", birthDate: "1990-05-12" },
        legalEntityId: companyId, administrativeEstablishmentId: establishmentId,
        startDate: "2026-09-01", contractType: "CDI", workingTime: 35,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.employment.status).toBe("PRE_HIRE");
    expect(body.contract.status).toBe("DRAFT");
    expect(body.assignment.operatingSiteId ?? null).toBeDefined();
    const hired = app.bus.eventsOf("ACME", "EmployeeHired");
    expect(hired.length).toBe(1);
  });

  it("détection de doublon sans fusion automatique → 409", async () => {
    await setupCompany(app);
    await app.inject({ method: "POST", url: "/api/v1/persons", headers: hrManager(), payload: { lastName: "Dupont", firstName: "Marie", birthDate: "1990-05-12" } });
    const res = await app.inject({ method: "POST", url: "/api/v1/persons", headers: hrManager(), payload: { lastName: "Dupont", firstName: "Marie", birthDate: "1990-05-12" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().details.candidates.length).toBe(1);
  });

  it("séparation création / signature : RH ne signe pas (403), le signataire signe (200)", async () => {
    const { companyId, establishmentId } = await setupCompany(app);
    const hire = await app.inject({
      method: "POST", url: "/api/v1/employments", headers: hrManager(),
      payload: { person: { lastName: "Martin", firstName: "Jean" }, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, startDate: "2026-09-01", contractType: "CDI" },
    });
    const contractId = hire.json().contract.id;

    const denied = await app.inject({ method: "POST", url: `/api/v1/contracts/${contractId}/sign`, headers: hrManager() });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({ method: "POST", url: `/api/v1/contracts/${contractId}/sign`, headers: signatory() });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("ACTIVE");
    expect(app.bus.eventsOf("ACME", "ContractSigned").length).toBe(1);
    expect(app.bus.eventsOf("ACME", "ContractActivated").length).toBe(1);
  });
});
