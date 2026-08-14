// Réinitialisation de mot de passe (Lot UI-1b).
//   Volet 1 (ce fichier) : auto-dépannage — demande par email → lien à usage unique (60 min,
//   token fort haché en base) → nouveau mot de passe → invalidation de toutes les sessions
//   (tokenVersion++), audit PasswordResetCompleted, email de confirmation.
import { createHash, randomBytes } from "crypto";
import { Repository } from "./repository.js";
import { EmailSender, resetRequestEmail, resetDoneEmail } from "./email.js";
import { hashPassword, validatePasswordStrength } from "./auth-service.js";
import { AppError, PasswordResetToken } from "./types.js";
import { uid } from "./store.js";

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
}
