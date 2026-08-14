// Volet 2 (Lot UI-1b) — reset par la RH / le directeur de site : périmètre (cloisonnement
// site A/B), hiérarchie de rôles, mot de passe temporaire (changement forcé), mode email, audit.
import { describe, it, expect } from "vitest";
import { build } from "../src/app.js";
import { MemoryRepository } from "../src/repository.js";
import { AuthService } from "../src/auth-service.js";
import { PasswordResetService } from "../src/services-reset.js";
import { employee } from "./helpers.js";
import type { EmailSender, EmailMessage } from "../src/email.js";

class SpySender implements EmailSender {
  sent: EmailMessage[] = [];
  async send(m: EmailMessage) { this.sent.push(m); }
}

const EST_A = "est-A", EST_B = "est-B";
async function ctx(repo: MemoryRepository) {
  const auth = new AuthService(repo);
  // Cible : un compte au site B (RH site).
  const target = await auth.createAccount({ email: "site-b@corp.fr", tenantId: "ACME", roleNames: ["HrOfficer"], password: "ancien mot 12", scopes: [{ type: "ESTABLISHMENT", id: EST_B }] });
  const spy = new SpySender();
  const svc = new PasswordResetService(repo, spy);
  return { auth, target, spy, svc };
}
const rhA: any = { tenantId: "ACME", userId: "rhA", roles: ["HrOfficer"], scopes: [{ type: "ESTABLISHMENT", id: EST_A }] };
const rhB: any = { tenantId: "ACME", userId: "rhB", roles: ["HrOfficer"], scopes: [{ type: "ESTABLISHMENT", id: EST_B }] };
const admin: any = { tenantId: "ACME", userId: "admin", roles: ["TenantAdmin"], scopes: [{ type: "TENANT" }] };

describe("Réinitialisation — dépannage RH (Volet 2)", () => {
  it("CLOISONNEMENT : un RH du site A ne peut pas réinitialiser un compte du site B (404)", async () => {
    const repo = new MemoryRepository(); const { svc } = await ctx(repo);
    await expect(svc.rhReset(rhA, { email: "site-b@corp.fr", mode: "temp", origin: "http://x" }))
      .rejects.toMatchObject({ status: 404 });
  });

  it("le RH du site B PEUT réinitialiser un compte de son site", async () => {
    const repo = new MemoryRepository(); const { svc } = await ctx(repo);
    const r = await svc.rhReset(rhB, { email: "site-b@corp.fr", mode: "temp", origin: "http://x" });
    expect(r.mode).toBe("temp");
    expect(r.tempPassword).toBeTruthy();
  });

  it("HIÉRARCHIE : un RH de site (rang établissement) ne peut pas réinitialiser un compte de rang supérieur (403)", async () => {
    const repo = new MemoryRepository(); const auth = new AuthService(repo);
    // Cible DRH (rang entité) rattachée au MÊME site B → dans le périmètre, mais rôle supérieur.
    await auth.createAccount({ email: "drh@corp.fr", tenantId: "ACME", roleNames: ["HrManager"], password: "ancien mot 12", scopes: [{ type: "ESTABLISHMENT", id: EST_B }] });
    const svc = new PasswordResetService(repo, new SpySender());
    await expect(svc.rhReset(rhB, { email: "drh@corp.fr", mode: "temp", origin: "http://x" }))
      .rejects.toMatchObject({ status: 403 });
  });

  it("MODE TEMPORAIRE : mot de passe renvoyé une fois, jamais envoyé par email ; force le changement", async () => {
    const repo = new MemoryRepository(); const { svc, spy } = await ctx(repo);
    const r = await svc.rhReset(admin, { email: "site-b@corp.fr", mode: "temp", origin: "http://x" });
    expect(r.tempPassword).toBeTruthy();
    // aucun email ne contient le mot de passe temporaire
    expect(spy.sent.every((m) => !m.text.includes(r.tempPassword!))).toBe(true);
    // login avec le temporaire → mustChangePassword = true (changement forcé)
    const app: any = build(repo);
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "site-b@corp.fr", password: r.tempPassword } });
    expect(login.statusCode).toBe(200);
    expect(login.json().mustChangePassword).toBe(true);
  });

  it("MODE EMAIL : envoie un lien à la cible, ne renvoie pas de mot de passe", async () => {
    const repo = new MemoryRepository(); const { svc, spy } = await ctx(repo);
    const r = await svc.rhReset(admin, { email: "site-b@corp.fr", mode: "email", origin: "http://x" });
    expect(r.mode).toBe("email");
    expect(r.tempPassword).toBeUndefined();
    expect(spy.sent.some((m) => /\/reset#token=/.test(m.text) && m.to === "site-b@corp.fr")).toBe(true);
  });

  it("AUDIT : chaque reset par un tiers est journalisé (PasswordResetByRh)", async () => {
    const repo = new MemoryRepository(); const { svc, target } = await ctx(repo);
    await svc.rhReset(admin, { email: "site-b@corp.fr", mode: "temp", origin: "http://x" });
    expect(repo.auditLog.some((a) => a.action === "PasswordResetByRh" && a.entityId === target.id)).toBe(true);
  });

  it("PERMISSION : un compte sans account.reset (Employee) ne peut pas appeler la route (403)", async () => {
    const repo = new MemoryRepository(); await ctx(repo);
    const app: any = build(repo);
    const res = await app.inject({ method: "POST", url: "/api/v1/accounts/reset", headers: employee(), payload: { email: "site-b@corp.fr", mode: "temp" } });
    expect(res.statusCode).toBe(403);
  });
});
