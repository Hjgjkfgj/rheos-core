// Réinitialisation de mot de passe (Lot UI-1b).
//   Volet 1 (ce fichier) : auto-dépannage — demande par email → lien à usage unique (60 min,
//   token fort haché en base) → nouveau mot de passe → invalidation de toutes les sessions
//   (tokenVersion++), audit PasswordResetCompleted, email de confirmation.
import { createHash, randomBytes } from "crypto";
import { Repository } from "./repository.js";
import { EmailSender, resetRequestEmail, resetDoneEmail, resetByRhEmail } from "./email.js";
import { hashPassword, validatePasswordStrength } from "./auth-service.js";
import { roleRank } from "./auth.js";
import { AppError, PasswordResetToken, AuthAccount, Ctx } from "./types.js";
import { uid } from "./store.js";

/// Mot de passe temporaire fort et typeable (lettres + chiffres, ≥ 12 car.). Passe
/// validatePasswordStrength par construction. Affiché UNE fois, jamais stocké/loggé en clair.
function generateTempPassword(): string {
  const base = randomBytes(6).toString("base64url").replace(/[-_]/g, "x");
  const digits = String(10 + Math.floor(Math.random() * 90));
  return `Rh${base}${digits}`;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const RESET_TTL_MS = 60 * 60 * 1000; // 60 minutes

export class PasswordResetService {
  constructor(private repo: Repository, private email: EmailSender) {}

  /// Demande de réinitialisation. NE RÉVÈLE RIEN : si le compte n'existe pas (ou est
  /// désactivé), on ne fait rien — la route renvoie TOUJOURS la même réponse générique.
  async requestReset(email: string, origin: string): Promise<void> {
    const acc = await this.repo.getAuthAccountByEmail(email.toLowerCase().trim());
    if (!acc || acc.disabled) return;
    await this.repo.invalidateAccountResetTokens(acc.id); // un seul lien actif à la fois
    const token = randomBytes(32).toString("base64url"); // fort ; jamais stocké en clair
    const rec: PasswordResetToken = {
      id: uid(), accountId: acc.id, tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString(), createdAt: new Date().toISOString(),
    };
    await this.repo.createPasswordResetToken(rec);
    const link = `${origin}/reset#token=${token}`; // token dans le fragment → jamais envoyé au serveur
    const { subject, text, html } = resetRequestEmail(link);
    await this.email.send({ to: acc.email, subject, text, html });
  }

  /// Finalisation : vérifie le token, change le mot de passe, invalide TOUTES les sessions,
  /// consomme le token, audite, et confirme par email.
  async completeReset(token: string, newPassword: string): Promise<{ email: string }> {
    const weak = validatePasswordStrength(newPassword);
    if (weak) throw new AppError(422, "weak_password", weak);
    const rec = await this.repo.getPasswordResetTokenByHash(sha256(token ?? ""));
    if (!rec || rec.usedAt || new Date(rec.expiresAt).getTime() < Date.now()) {
      throw new AppError(400, "invalid_token", "Lien invalide ou expiré. Refaites une demande de réinitialisation.");
    }
    const acc = await this.repo.getAuthAccountById(rec.accountId);
    if (!acc) throw new AppError(400, "invalid_token", "Lien invalide.");
    await this.repo.updateAuthAccount(acc.id, {
      passwordHash: hashPassword(newPassword),
      tokenVersion: acc.tokenVersion + 1, // déconnecte toutes les sessions existantes
      mustChangePassword: false,
    });
    await this.repo.markPasswordResetTokenUsed(rec.id, new Date().toISOString());
    await this.repo.invalidateAccountResetTokens(acc.id); // aucun autre lien ne reste valable
    await this.repo.appendAudit({
      id: uid(), tenantId: acc.tenantId, userId: acc.id,
      action: "PasswordResetCompleted", entityType: "AuthAccount", entityId: acc.id,
      at: new Date().toISOString(),
    });
    const done = resetDoneEmail();
    await this.email.send({ to: acc.email, subject: done.subject, text: done.text, html: done.html });
    return { email: acc.email };
  }

  // =========================================================================
  // Volet 2 — Dépannage par la RH / le directeur de site.
  // L'acteur réinitialise le compte d'un tiers, DANS SON PÉRIMÈTRE et sans dépasser
  // sa hiérarchie. Deux modes : lien email, ou mot de passe temporaire (affiché une fois).
  // =========================================================================
  async rhReset(actor: Ctx, opts: { accountId?: string; personId?: string; email?: string; mode: "email" | "temp"; origin: string; actorLabel?: string }): Promise<{ mode: "email" | "temp"; tempPassword?: string; email: string }> {
    // 1) Résolution de la cible (bornée au tenant de l'acteur).
    let target: AuthAccount | undefined;
    if (opts.accountId) target = await this.repo.getAuthAccountById(opts.accountId);
    else if (opts.personId) target = await this.repo.getAuthAccountByPersonId(opts.personId);
    else if (opts.email) target = await this.repo.getAuthAccountByEmail(opts.email.toLowerCase().trim());
    if (!target || target.tenantId !== actor.tenantId) throw new AppError(404, "not_found", "Compte introuvable dans votre périmètre.");

    // 2) Hiérarchie : on ne réinitialise pas un compte d'un rôle SUPÉRIEUR au sien.
    if (roleRank(target.roleNames) > roleRank(actor.roles)) {
      throw new AppError(403, "forbidden", "Vous ne pouvez pas réinitialiser un compte d'un rôle supérieur au vôtre.");
    }
    // 3) Périmètre (ABAC). 404 hors périmètre (ne révèle pas l'existence hors établissement/entité).
    if (!(await this.actorCoversTarget(actor, target))) {
      throw new AppError(404, "not_found", "Compte introuvable dans votre périmètre.");
    }

    const actorLabel = opts.actorLabel || "votre service RH";
    if (opts.mode === "temp") {
      const temp = generateTempPassword();
      await this.repo.updateAuthAccount(target.id, { passwordHash: hashPassword(temp), tokenVersion: target.tokenVersion + 1, mustChangePassword: true });
      await this.repo.invalidateAccountResetTokens(target.id);
      await this.auditRh(actor, target, "temp");
      const info = resetByRhEmail(actorLabel, false);
      await this.email.send({ to: target.email, subject: info.subject, text: info.text, html: info.html });
      return { mode: "temp", tempPassword: temp, email: target.email }; // affiché UNE fois — jamais loggé ni envoyé
    }
    // mode "email" : on envoie à la cible un lien à usage unique (comme le Volet 1).
    await this.repo.invalidateAccountResetTokens(target.id);
    const token = randomBytes(32).toString("base64url");
    await this.repo.createPasswordResetToken({ id: uid(), accountId: target.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString(), createdAt: new Date().toISOString() });
    const req = resetRequestEmail(`${opts.origin}/reset#token=${token}`);
    await this.email.send({ to: target.email, subject: req.subject, text: req.text, html: req.html });
    await this.auditRh(actor, target, "email");
    return { mode: "email", email: target.email };
  }

  private async auditRh(actor: Ctx, target: AuthAccount, method: "email" | "temp") {
    await this.repo.appendAudit({
      id: uid(), tenantId: actor.tenantId, userId: actor.userId,
      action: "PasswordResetByRh", entityType: "AuthAccount", entityId: target.id,
      after: { method, targetEmail: target.email }, reason: `réinitialisation par un tiers (${method})`,
      at: new Date().toISOString(),
    });
  }

  /// L'acteur couvre-t-il la cible ? TENANT → tout ; sinon la cible doit tomber dans un
  /// établissement (ou une entité) du périmètre de l'acteur.
  private async actorCoversTarget(actor: Ctx, target: AuthAccount): Promise<boolean> {
    const scopes = actor.scopes ?? [];
    if (scopes.some((s) => s.type === "TENANT")) return true;
    const estReach = new Set<string>();
    const entityReach = new Set<string>();
    for (const s of scopes) {
      if (s.type === "ESTABLISHMENT" && s.id) estReach.add(s.id);
      if (s.type === "LEGAL_ENTITY" && s.id) {
        entityReach.add(s.id);
        for (const e of await this.repo.listEstablishmentsByCompany(actor.tenantId, s.id)) estReach.add(e.id);
      }
    }
    const loc = await this.resolveAccountLocation(target);
    if (loc.establishmentId && estReach.has(loc.establishmentId)) return true;
    if (loc.legalEntityId && entityReach.has(loc.legalEntityId)) return true;
    return false;
  }

  /// Localise un compte : via la personne rattachée (collaborateur → emploi actif →
  /// établissement + entité), sinon via ses propres périmètres (utilisateur de gestion).
  private async resolveAccountLocation(target: AuthAccount): Promise<{ establishmentId?: string; legalEntityId?: string }> {
    if (target.personId) {
      const emp = await this.repo.findActiveEmploymentByPerson(target.tenantId, target.personId);
      if (emp) {
        const est = await this.repo.getEstablishment(target.tenantId, emp.administrativeEstablishmentId);
        return { establishmentId: emp.administrativeEstablishmentId, legalEntityId: emp.legalEntityId ?? est?.legalEntityId };
      }
    }
    const scopes = target.scopes ?? [];
    const establishmentId = scopes.find((s) => s.type === "ESTABLISHMENT" && s.id)?.id;
    let legalEntityId = scopes.find((s) => s.type === "LEGAL_ENTITY" && s.id)?.id;
    if (establishmentId && !legalEntityId) legalEntityId = (await this.repo.getEstablishment(target.tenantId, establishmentId))?.legalEntityId;
    return { establishmentId, legalEntityId };
  }
}
