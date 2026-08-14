// Fondation d'identité (Lot UI-1b) : comptes d'authentification PERSISTANTS
// (AuthAccount), invalidation de session par tokenVersion, mot de passe temporaire,
// unicité de l'email, et repli sur les comptes de démonstration en mémoire.
import { describe, it, expect } from "vitest";
import { build } from "../src/app.js";
import { MemoryRepository } from "../src/repository.js";
import { AuthService } from "../src/auth-service.js";

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe("Fondation d'identité — AuthAccount", () => {
  it("login depuis un compte persistant + redirection par rôle", async () => {
    const repo = new MemoryRepository();
    await new AuthService(repo).createAccount({ email: "boss@corp.fr", tenantId: "CORP", roleNames: ["TenantAdmin"], password: "correct horse 42" });
    const app: any = build(repo);
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "boss@corp.fr", password: "correct horse 42" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
    expect(res.json().redirect).toBe("/console");
    expect(res.json().mustChangePassword).toBe(false);
  });

  it("mauvais mot de passe → 401 (message générique, pas d'énumération)", async () => {
    const repo = new MemoryRepository();
    await new AuthService(repo).createAccount({ email: "u@corp.fr", tenantId: "CORP", roleNames: ["HrManager"], password: "bon mot de passe" });
    const app: any = build(repo);
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "u@corp.fr", password: "mauvais" } });
    expect(res.statusCode).toBe(401);
  });

  it("mot de passe temporaire : mustChangePassword remonté au login", async () => {
    const repo = new MemoryRepository();
    await new AuthService(repo).createAccount({ email: "temp@corp.fr", tenantId: "CORP", roleNames: ["HrManager"], password: "temporaire 123", mustChangePassword: true });
    const app: any = build(repo);
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "temp@corp.fr", password: "temporaire 123" } });
    expect(res.json().mustChangePassword).toBe(true);
  });

  it("invalidation de session : incrémenter tokenVersion rejette les anciens jetons (401)", async () => {
    const repo = new MemoryRepository();
    const auth = new AuthService(repo);
    const acc = await auth.createAccount({ email: "sess@corp.fr", tenantId: "CORP", roleNames: ["HrManager"], password: "phrase de passe" });
    const app: any = build(repo);
    const token = (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "sess@corp.fr", password: "phrase de passe" } })).json().token;
    // Le jeton fonctionne tant que la tokenVersion correspond.
    expect((await app.inject({ method: "GET", url: "/api/v1/notifications", headers: bearer(token) })).statusCode).toBe(200);
    // Reset simulé : on incrémente la tokenVersion du compte → toutes les sessions tombent.
    await repo.updateAuthAccount(acc.id, { tokenVersion: acc.tokenVersion + 1 });
    const revoked = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: bearer(token) });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().code).toBe("session_revoked");
  });

  it("unicité : createAccount refuse un email déjà pris (409)", async () => {
    const repo = new MemoryRepository();
    const auth = new AuthService(repo);
    await auth.createAccount({ email: "dup@corp.fr", tenantId: "CORP", roleNames: ["HrManager"], password: "phrase de passe" });
    await expect(auth.createAccount({ email: "dup@corp.fr", tenantId: "CORP", roleNames: ["HrManager"], password: "autre phrase" }))
      .rejects.toMatchObject({ code: "already_exists" });
  });

  it("repli : les comptes de démonstration en mémoire fonctionnent encore", async () => {
    const app: any = build(); // MemoryRepository vide → aucun compte persistant → repli seed
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "admin@acme", password: "secret" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().redirect).toBe("/console");
  });
});
