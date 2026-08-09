// DoD globale — cycle complet de bout en bout (critère de sortie Lot 8) :
// embauche → contrat validé → signé → dossier (employee360) → RUP → coffre-fort,
// avec séparation des droits et traçabilité événementielle.
import { describe, it, expect } from "vitest";
import { build } from "../../src/app.js";
import { createHash } from "crypto";
import { hrManager, tenantAdmin, signatory } from "../helpers.js";

describe("DoD — cycle complet embauche → contrat signé → dossier → RUP → coffre-fort", () => {
  it("déroule le cycle avec droits, projections et coffre-fort scellé", async () => {
    const app = build();

    // 1) Onboarding entreprise (TenantAdmin) + établissement (HrManager)
    const co = (await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } })).json();
    const est = (await app.inject({ method: "POST", url: `/api/v1/companies/${co.id}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Établissement Marseille", idcc: "2216" } })).json();

    // 2) Embauche en cascade (HrManager) → Person/Employment(PRE_HIRE)/Contract(DRAFT)/Assignment
    const hire = (await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager(), payload: { person: { lastName: "Dupont", firstName: "Marie" }, legalEntityId: co.id, administrativeEstablishmentId: est.id, startDate: "2026-01-01", contractType: "CDI", grossMonthly: 2000, workingTime: 35 } })).json();
    expect(hire.employment.status).toBe("PRE_HIRE");
    expect(hire.contract.status).toBe("DRAFT");

    // 3) Validation (HrManager) puis SIGNATURE (Signatory) — séparation stricte
    expect((await app.inject({ method: "POST", url: `/api/v1/contracts/${hire.contract.id}/validate`, headers: hrManager() })).json().status).toBe("VALIDATED");
    expect((await app.inject({ method: "POST", url: `/api/v1/contracts/${hire.contract.id}/sign`, headers: hrManager() })).statusCode).toBe(403); // RH ne signe pas
    const signed = await app.inject({ method: "POST", url: `/api/v1/contracts/${hire.contract.id}/sign`, headers: signatory() });
    expect(signed.json().status).toBe("ACTIVE");

    // 4) Dossier collaborateur (Employee 360) — projection
    const dossier = (await app.inject({ method: "GET", url: `/api/v1/employments/${hire.employment.id}/employee360`, headers: hrManager() })).json();
    expect(dossier.person.lastName).toBe("Dupont");
    expect(dossier.currentContract.status).toBe("ACTIVE");
    expect(dossier.timeline.length).toBeGreaterThan(0);

    // 5) Registre Unique du Personnel — généré dynamiquement (jamais de base parallèle)
    const rup = (await app.inject({ method: "GET", url: `/api/v1/companies/${co.id}/registry`, headers: hrManager() })).json();
    expect(rup).toHaveLength(1);
    expect(rup[0]).toMatchObject({ lastName: "Dupont", establishmentSiret: "55210055400013", contractType: "CDI", startDate: "2026-01-01" });

    // 6) Coffre-fort : dépôt scellé SHA-256 (WORM) + intégrité vérifiable
    const content = "Contrat de travail — Marie Dupont";
    const doc = (await app.inject({ method: "POST", url: `/api/v1/persons/${hire.employment.personId}/documents`, headers: hrManager(), payload: { type: "CONTRACT", label: "Contrat CDI signé", content } })).json();
    expect(doc.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    const verify = await app.inject({ method: "POST", url: `/api/v1/documents/${doc.id}/verify`, headers: hrManager(), payload: { content } });
    expect(verify.json().valid).toBe(true);
    expect((await app.inject({ method: "POST", url: `/api/v1/documents/${doc.id}/verify`, headers: hrManager(), payload: { content: content + "!" } })).json().valid).toBe(false);

    // 7) Traçabilité : les événements clés du cycle sont publiés (append-only)
    const types = app.bus.eventsOf("ACME").map((e: any) => e.type);
    for (const t of ["CompanyCreated", "EstablishmentCreated", "EmployeeHired", "ContractCreated", "ContractValidated", "ContractSigned", "ContractActivated", "DocumentDeposited"]) {
      expect(types, `événement ${t}`).toContain(t);
    }
  });
});
