import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, tenantAdmin } from "./helpers.js";

describe("Convention collective datée (D1)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("résout la valeur du point selon la date (effective-dated)", async () => {
    const before = await app.inject({ method: "GET", url: "/api/v1/conventions/2216/resolve?coef=110&date=2025-06-01", headers: hrManager() });
    const after = await app.inject({ method: "GET", url: "/api/v1/conventions/2216/resolve?coef=110&date=2026-06-01", headers: hrManager() });
    expect(before.json().valeurPoint).toBe(20.0);
    expect(after.json().valeurPoint).toBe(20.5);
    // minimum = points(90) * valeur du point
    expect(before.json().minimumMensuel).toBe(1800);
    expect(after.json().minimumMensuel).toBe(1845);
  });

  it("expose la grille résolue à une date", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/conventions/2216/grid?date=2026-01-01", headers: hrManager() });
    const grid = res.json().grid;
    expect(res.json().valeurPoint).toBe(20.5);
    expect(grid.find((g: any) => g.coef === 150).minimumMensuel).toBe(105 * 20.5);
  });
});

describe("Convention appliquée à l'embauche", () => {
  let app: any;
  let companyId: string, establishmentId: string, positionId: string;
  beforeEach(async () => {
    app = build();
    const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
    companyId = c.json().id;
    const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Marseille", idcc: "2216" } });
    establishmentId = e.json().id;
    const p = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/positions`, headers: hrManager(), payload: { title: "Employé commercial", coefficient: 110 } });
    positionId = p.json().id;
  });

  it("refuse une rémunération sous le minimum conventionnel → 409", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/employments", headers: hrManager(),
      payload: { person: { lastName: "Bas", firstName: "Salaire" }, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, positionId, startDate: "2026-06-01", contractType: "CDI", grossMonthly: 1500 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("below_convention_minimum");
  });

  it("accepte au-dessus du minimum et renseigne classification/coefficient", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/employments", headers: hrManager(),
      payload: { person: { lastName: "Ok", firstName: "Salaire" }, legalEntityId: companyId, administrativeEstablishmentId: establishmentId, positionId, startDate: "2026-06-01", contractType: "CDI", grossMonthly: 2000 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().convention.minimumMensuel).toBe(1845);
    expect(res.json().contract.coefficient).toBe(110);
  });
});

describe("Rétention RGPD au dépôt (D10)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("applique la durée légale par défaut selon le type (bulletin = 50 ans)", async () => {
    const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
    const per = await app.inject({ method: "POST", url: "/api/v1/persons", headers: hrManager(), payload: { lastName: "Doc", firstName: "Test" } });
    const personId = per.json().id;
    const res = await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/documents`, headers: hrManager(), payload: { type: "PAYSLIP", label: "Bulletin 2026-06", content: "xxx" } });
    expect(res.statusCode).toBe(201);
    const year = new Date(res.json().retentionUntil).getFullYear();
    expect(year).toBe(new Date().getFullYear() + 50);
  });
});
