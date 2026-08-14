// Volet 1 (Lot UI-1b) — auto-dépannage : demande → lien à usage unique (60 min, haché) →
// nouveau mot de passe → invalidation des sessions + audit + anti-énumération.
import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { build } from "../src/app.js";
import { MemoryRepository } from "../src/repository.js";
import { AuthService } from "../src/auth-service.js";
import { PasswordResetService } from "../src/services-reset.js";
import type { EmailSender, EmailMessage } from "../src/email.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

class SpySender implements EmailSender {
  sent: EmailMessage[] = [];
  async send(m: EmailMessage) { this.sent.push(m); }
  lastToken(): string {
    const t = [...this.sent].reverse().map((x) => x.text).find((tx) => /\/reset#token=/.test(tx));
    const m = t && t.match(/\/reset#token=(\S+)/);
    return m ? m[1] : "";
  }
}

async function setup() {
  const repo = new MemoryRepository();
  const auth = new AuthService(repo);
  const acc = await auth.createAccount({ email: "u@corp.fr", tenantId: "CORP", roleNames: ["HrManager"], password: "ancien mot 12" });
  const spy = new SpySender();
  const svc = new PasswordResetService(repo, spy);
  return { repo, acc, spy, svc };
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe("Réinitialisation — auto-dépannage (Volet 1)", () => {
  it("parcours complet : demande → lien → nouveau mot de passe ; l'ancien ne marche plus", async () => {
    const { repo, spy, svc } = await setup();
    await svc.requestReset("u@corp.fr", "http://localhost:3000");
    const token = spy.lastToken();
    expect(token).toBeTruthy();
    await svc.completeReset(token, "nouveau mot 34");
    const app: any = build(repo);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "u@corp.fr", password: "nouveau mot 34" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "u@corp.fr", password: "ancien mot 12" } })).statusCode).toBe(401);
    // 2 emails : la demande + la confirmation de changement
    expect(spy.sent.length).toBe(2);
    expect(spy.sent[1].subject).toMatch(/modifié/i);
  });

  it("audit PasswordResetCompleted écrit", async () => {
    const { repo, spy, svc, acc } = await setup();
    await svc.requestReset("u@corp.fr", "http://x");
    await svc.completeReset(spy.lastToken(), "nouveau mot 34");
    expect(repo.auditLog.some((a) => a.action === "PasswordResetCompleted" && a.entityId === acc.id)).toBe(true);
  });

  it("token DÉJÀ UTILISÉ → rejeté", async () => {
    const { spy, svc } = await setup();
    await svc.requestReset("u@corp.fr", "http://x");
    const token = spy.lastToken();
    await svc.completeReset(token, "nouveau mot 34");
    await expect(svc.completeReset(token, "encore autre 56")).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("token EXPIRÉ → rejeté", async () => {
    const { repo, acc, svc } = await setup();
    await repo.createPasswordResetToken({ id: "t-exp", accountId: acc.id, tokenHash: sha256("brut"), expiresAt: new Date(Date.now() - 1000).toISOString(), createdAt: new Date().toISOString() });
    await expect(svc.completeReset("brut", "nouveau mot 34")).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("token FALSIFIÉ / inconnu → rejeté", async () => {
    const { svc } = await setup();
    await expect(svc.completeReset("n-existe-pas", "nouveau mot 34")).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("mot de passe trop faible → 422 (règles de robustesse)", async () => {
    const { spy, svc } = await setup();
    await svc.requestReset("u@corp.fr", "http://x");
    await expect(svc.completeReset(spy.lastToken(), "court")).rejects.toMatchObject({ code: "weak_password" });
  });

  it("invalidation de session : après reset, les anciens jetons sont rejetés (401)", async () => {
    const { repo, spy, svc } = await setup();
    const app: any = build(repo);
    const before = (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "u@corp.fr", password: "ancien mot 12" } })).json().token;
    expect((await app.inject({ method: "GET", url: "/api/v1/notifications", headers: bearer(before) })).statusCode).toBe(200);
    await svc.requestReset("u@corp.fr", "http://x");
    await svc.completeReset(spy.lastToken(), "nouveau mot 34");
    expect((await app.inject({ method: "GET", url: "/api/v1/notifications", headers: bearer(before) })).statusCode).toBe(401);
  });

  it("anti-énumération : réponse identique pour un email existant ou non", async () => {
    const { repo } = await setup();
    const app: any = build(repo);
    const r1 = await app.inject({ method: "POST", url: "/api/v1/auth/forgot-password", payload: { email: "u@corp.fr" } });
    const r2 = await app.inject({ method: "POST", url: "/api/v1/auth/forgot-password", payload: { email: "personne@nulle-part.fr" } });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.json()).toEqual(r2.json());
    expect(r1.json().message).toMatch(/Si un compte existe/i);
  });
});
