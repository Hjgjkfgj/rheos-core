import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, signatory, tenantAdmin } from "./helpers.js";

async function base(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site" } });
  return { companyId, establishmentId: e.json().id };
}
async function hire(app: any, companyId: string, establishmentId: string, lastName: string, managerEmploymentId?: string) {
  const h = await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName, firstName: "X" }, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, startDate: "2026-01-01", contractType: "CDI", grossMonthly: 2000, managerEmploymentId } });
  return h.json();
}

describe("Organigramme", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("construit l'arbre : directeur en racine, équipe rattachée", async () => {
    const { companyId, establishmentId } = await base(app);
    const dir = await hire(app, companyId, establishmentId, "Directeur");
    const dirId = dir.employment.id;
    await hire(app, companyId, establishmentId, "Manager1", dirId);
    await hire(app, companyId, establishmentId, "Manager2", dirId);

    const res = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/org-chart`, headers: hrManager() });
    expect(res.statusCode).toBe(200);
    const org = res.json();
    expect(org.count).toBe(3);
    expect(org.roots.length).toBe(1);
    expect(org.roots[0].name).toContain("Directeur");
    expect(org.roots[0].reports.length).toBe(2);
  });
});

describe("Avenant (workflow contractuel)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("créer → signer applique la modification au contrat, l'avenant reste l'historique", async () => {
    const { companyId, establishmentId } = await base(app);
    const h = await hire(app, companyId, establishmentId, "Salarie");
    const contractId = h.contract.id;

    const am = await app.inject({ method: "POST", url: `/api/v1/contracts/${contractId}/amendments`, headers: hrManager(), payload: { subject: "Augmentation", effectiveDate: "2026-12-01", changes: { grossMonthly: 2300 } } });
    expect(am.statusCode).toBe(201);
    expect(am.json().status).toBe("DRAFT");

    // RH ne peut pas signer un avenant
    const denied = await app.inject({ method: "POST", url: `/api/v1/amendments/${am.json().id}/sign`, headers: hrManager() });
    expect(denied.statusCode).toBe(403);

    const signed = await app.inject({ method: "POST", url: `/api/v1/amendments/${am.json().id}/sign`, headers: signatory() });
    expect(signed.statusCode).toBe(200);
    expect(signed.json().status).toBe("APPLIED");

    // le contrat reflète la modification
    const list = await app.inject({ method: "GET", url: `/api/v1/contracts/${contractId}/amendments`, headers: hrManager() });
    expect(list.json().length).toBe(1);

    const emp360 = await app.inject({ method: "GET", url: `/api/v1/employments/${h.employment.id}/employee360`, headers: hrManager() });
    expect(emp360.json().currentContract.grossMonthly).toBe(2300);
  });
});
