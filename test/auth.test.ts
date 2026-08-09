import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { signToken } from "../src/jwt.js";

describe("Authentification JWT (ADR-006)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("login avec identifiants valides renvoie un jeton exploitable", async () => {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "rh@acme", password: "secret" } });
    expect(login.statusCode).toBe(200);
    const token = login.json().token;
    expect(token.split(".").length).toBe(3);

    // le jeton (HrManager) permet d'appeler une route protégée qu'il est autorisé à voir
    const res = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it("login avec mauvais mot de passe → 401", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "rh@acme", password: "wrong" } });
    expect(res.statusCode).toBe(401);
  });

  it("route protégée sans jeton → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/companies/x" });
    expect(res.statusCode).toBe(401);
  });

  it("jeton falsifié (signature invalide) → 401", async () => {
    const good = signToken({ sub: "rh", tenantId: "ACME", roles: ["HrManager"] });
    const tampered = good.slice(0, -3) + "aaa";
    const res = await app.inject({ method: "GET", url: "/api/v1/companies/x", headers: { authorization: `Bearer ${tampered}` } });
    expect(res.statusCode).toBe(401);
  });

  it("jeton expiré → 401", async () => {
    const expired = signToken({ sub: "rh", tenantId: "ACME", roles: ["HrManager"] }, { expiresInSec: -10 });
    const res = await app.inject({ method: "GET", url: "/api/v1/companies/x", headers: { authorization: `Bearer ${expired}` } });
    expect(res.statusCode).toBe(401);
  });
});
