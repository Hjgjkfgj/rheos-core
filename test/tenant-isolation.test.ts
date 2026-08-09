import { describe, it, expect } from "vitest";
import { build } from "../src/app.js";
import { tenantAdmin } from "./helpers.js";

describe("Isolation multi-tenant (ADR-006)", () => {
  it("un tenant ne peut pas lire les données d'un autre", async () => {
    const app = build();
    // BETA crée une société
    const created = await app.inject({
      method: "POST", url: "/api/v1/companies",
      headers: tenantAdmin("BETA"), payload: { legalName: "BETA SAS", siren: "111111111" },
    });
    expect(created.statusCode).toBe(201);
    const betaId = created.json().id;

    // ACME tente de la lire → 404
    const res = await app.inject({
      method: "GET", url: `/api/v1/companies/${betaId}`, headers: tenantAdmin("ACME"),
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuse l'accès sans authentification", async () => {
    const app = build();
    const res = await app.inject({ method: "GET", url: "/api/v1/companies/x" });
    expect(res.statusCode).toBe(401);
  });
});
