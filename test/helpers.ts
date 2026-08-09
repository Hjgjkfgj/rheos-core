import { signToken } from "../src/jwt.js";

// Émet un vrai JWT (signé avec le même secret que l'app) → exerce le chemin de
// vérification Bearer. Après login, un client réel utilise exactement ce header.
const bearer = (p: { sub: string; tenantId: string; roles: string[]; personId?: string }) => ({
  authorization: `Bearer ${signToken(p)}`,
});

export const hrManager = (tenantId = "ACME") => bearer({ sub: "rh", tenantId, roles: ["HrManager"] });
export const signatory = (tenantId = "ACME") => bearer({ sub: "dg", tenantId, roles: ["Signatory"] });
export const tenantAdmin = (tenantId = "ACME") => bearer({ sub: "admin", tenantId, roles: ["TenantAdmin"] });
export const manager = (tenantId = "ACME") => bearer({ sub: "mgr", tenantId, roles: ["Manager"] });
export const employee = (tenantId = "ACME", personId = "p1") => bearer({ sub: "emp", tenantId, personId, roles: ["Employee"] });

export async function setupHire(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site Marseille" } });
  const hire = await app.inject({
    method: "POST", url: "/api/v1/employments", headers: hrManager(),
    payload: { person: { lastName: "Dupont", firstName: "Marie" }, legalEntityId: companyId, administrativeEstablishmentId: e.json().id, startDate: "2026-09-01", contractType: "CDI" },
  });
  return { companyId, employmentId: hire.json().employment.id, personId: hire.json().employment.personId };
}
