// D10 Coffre-fort documentaire (scellement WORM + signature) & D3 Temps (congés).
// Dépend du port Repository (ADR-014).
import { createHash } from "crypto";
import { uid } from "./store.js";
import { EventBus } from "./events.js";
import { Repository } from "./repository.js";
import { assertCan } from "./auth.js";
import { computeRetentionUntil, retentionPolicyFor } from "./domain/retention.js";
import { renderTemplate, missingVariables, MissingTemplateDataError } from "./domain/templates.js";
import { SignatureProvider, OtpSignatureProvider } from "./signature.js";
import { countLeaveDays, acquiredDays, referencePeriod, LEAVE_TYPE_POLICY, APPROVAL_POLICY } from "./domain/leave.js";
import { DocumentStore, MemoryDocumentStore } from "./doc-store.js";
import { encryptBytes, decryptBytes } from "./domain/doc-crypto.js";
import { Ctx, AppError, DocumentType, DocumentStatus, LeaveType } from "./types.js";

// Coffre-fort — garde-fous de dépôt (Lot 19).
const MAX_DOC_BYTES = 20 * 1024 * 1024; // 20 Mo
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .doc/.docx
  "application/octet-stream",
]);

export class MvpServices {
  constructor(private repo: Repository, private bus: EventBus, private signer: SignatureProvider = new OtpSignatureProvider(), private docStore: DocumentStore = new MemoryDocumentStore()) {}

  // --------------------------- D10 — Coffre-fort ---------------------------
  // Le contenu est chiffré (AES-256-GCM, clé PAR TENANT) puis écrit dans le stockage
  // objet ; la base ne garde que le sha256 (WORM) + la référence. L'admin technique
  // (sans document.read) n'accède ni au contenu ni à la clé.
  async depositDocument(ctx: Ctx, input: { personId?: string; employmentId?: string; type: DocumentType; category?: string; label: string; content?: string; contentBase64?: string; contentType?: string; sha256?: string; periodStart?: string; periodEnd?: string; retentionUntil?: string; legalHold?: boolean }) {
    assertCan(ctx, "document.write");
    if (!input.personId && !input.employmentId) throw new AppError(400, "bad_request", "personId ou employmentId requis");
    // Contenu : base64 (binaire, ex. PDF) ou texte. On scelle le SHA-256 du contenu EN CLAIR.
    const bytes = input.contentBase64 != null ? Buffer.from(input.contentBase64, "base64")
      : input.content != null ? Buffer.from(input.content, "utf8") : undefined;
    const id = uid();
    let sha256 = input.sha256;
    let storageRef = `vault://${id}`;                 // référence par défaut (dépôt métadonnées seul)
    let contentType: string | undefined, sizeBytes: number | undefined;
    if (bytes) {
      if (bytes.length > MAX_DOC_BYTES) throw new AppError(413, "too_large", `Document trop volumineux (max ${MAX_DOC_BYTES / 1024 / 1024} Mo)`);
      contentType = input.contentType ?? "application/octet-stream";
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) throw new AppError(415, "unsupported_type", `Type de contenu non autorisé : ${contentType}`);
      sha256 = createHash("sha256").update(bytes).digest("hex");
      sizeBytes = bytes.length;
      storageRef = `tenants/${ctx.tenantId}/documents/${id}`;
      // Chiffrement PAR TENANT puis écriture dans le stockage objet (jamais de clair au repos).
      await this.docStore.put(storageRef, encryptBytes(ctx.tenantId, bytes), "application/octet-stream");
    }
    if (!sha256) throw new AppError(400, "bad_request", "content, contentBase64 ou sha256 requis pour le scellement");
    const depositDate = new Date().toISOString().slice(0, 10);
    let employmentEndDate: string | undefined;
    if (input.employmentId) employmentEndDate = (await this.repo.getEmployment(ctx.tenantId, input.employmentId))?.endDate;
    const policy = retentionPolicyFor(input.type);
    const retentionUntil = input.retentionUntil ?? computeRetentionUntil(input.type, { depositDate, employmentEndDate });
    const doc: any = {
      id, tenantId: ctx.tenantId, personId: input.personId, employmentId: input.employmentId,
      type: input.type, category: input.category, label: input.label,
      periodStart: input.periodStart, periodEnd: input.periodEnd, version: 1,
      storageRef, sha256, contentType, sizeBytes,
      status: "DRAFT" as DocumentStatus, signatureStatus: "NONE",
      retentionUntil, retentionTrigger: policy.trigger, legalHold: input.legalHold ?? false,
      createdBy: ctx.userId, createdAt: new Date().toISOString(), sealed: true,
    };
    await this.repo.createDocument(doc);
    // Notification/événement SANS contenu sensible (type + empreinte, jamais le libellé ni le corps).
    this.bus.publish(ctx.tenantId, "Document", doc.id, "DocumentDeposited", { type: doc.type, sha256, retentionUntil: doc.retentionUntil }, ctx.userId);
    return doc;
  }

  async getDocument(ctx: Ctx, id: string) {
    assertCan(ctx, "document.read");
    const d = await this.repo.getDocument(ctx.tenantId, id);
    if (!d) throw new AppError(404, "not_found", "Document introuvable");
    return d;
  }

  async listDocuments(ctx: Ctx, personId: string) {
    assertCan(ctx, "document.read");
    return this.repo.listDocumentsByPerson(ctx.tenantId, personId);
  }

  /// Contrôle d'intégrité : le contenu fourni doit reproduire l'empreinte scellée.
  async verifyIntegrity(ctx: Ctx, id: string, content: string): Promise<{ valid: boolean; sha256: string }> {
    const d = await this.getDocument(ctx, id);
    const computed = createHash("sha256").update(content).digest("hex");
    return { valid: computed === d.sha256, sha256: d.sha256 };
  }

  /// Téléchargement du contenu (Lot 19) : contrôle de droits (document.read + tenant),
  /// déchiffrement par tenant, VÉRIFICATION D'INTÉGRITÉ (SHA-256 recalculé = registre,
  /// sinon erreur explicite), et JOURNALISATION de chaque téléchargement.
  async downloadDocument(ctx: Ctx, id: string): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
    const d: any = await this.getDocument(ctx, id); // 404 hors tenant / introuvable ; 403 sans document.read
    if (!d.storageRef || d.storageRef.startsWith("vault://")) {
      throw new AppError(409, "no_content", "Aucun contenu stocké pour ce document (dépôt métadonnées seul).");
    }
    let blob: Buffer;
    try { blob = await this.docStore.get(d.storageRef); }
    catch { throw new AppError(404, "content_missing", "Contenu introuvable dans le stockage objet."); }
    const bytes = decryptBytes(ctx.tenantId, blob);
    const computed = createHash("sha256").update(bytes).digest("hex");
    if (computed !== d.sha256) {
      throw new AppError(409, "integrity_failure", "Échec d'intégrité : l'empreinte du contenu ne correspond pas au registre scellé.");
    }
    await this.repo.appendAudit({ id: uid(), tenantId: ctx.tenantId, userId: ctx.userId, action: "document.download", entityType: "Document", entityId: id, at: new Date().toISOString() });
    this.bus.publish(ctx.tenantId, "Document", id, "DocumentDownloaded", { sha256: d.sha256 }, ctx.userId);
    return { bytes, contentType: d.contentType || "application/octet-stream", filename: d.label || id };
  }

  // --- Cycle de vie documentaire DRAFT→REVIEW→VALIDATED→SIGNED→PUBLISHED→ARCHIVED ---
  private async transitionStatus(ctx: Ctx, id: string, from: DocumentStatus[], to: DocumentStatus, event: string) {
    assertCan(ctx, "document.write");
    const d: any = await this.getDocument(ctx, id);
    if (d.signatureStatus === "SIGNED" && to !== "PUBLISHED" && to !== "ARCHIVED") {
      throw new AppError(409, "immutable", "Document signé : immuable"); // un signé ne redevient pas brouillon
    }
    if (!from.includes(d.status)) throw new AppError(409, "conflict", `Transition invalide : ${d.status} → ${to}`);
    const updated = await this.repo.updateDocument(ctx.tenantId, id, { status: to });
    this.bus.publish(ctx.tenantId, "Document", id, event, { status: to }, ctx.userId);
    return updated;
  }
  validateDocument(ctx: Ctx, id: string) { return this.transitionStatus(ctx, id, ["DRAFT", "REVIEW"], "VALIDATED", "DocumentValidated"); }
  publishDocument(ctx: Ctx, id: string) { return this.transitionStatus(ctx, id, ["VALIDATED", "SIGNED"], "PUBLISHED", "DocumentPublished"); }

  /// Demande de signature : ordonne les signataires, émet un défi OTP (provider).
  async requestSignature(ctx: Ctx, id: string, input: { signers?: string[] } = {}) {
    assertCan(ctx, "document.write");
    const d: any = await this.getDocument(ctx, id);
    if (d.signatureStatus === "SIGNED") throw new AppError(409, "conflict", "Document déjà signé");
    const signers = input.signers?.length ? input.signers : [ctx.userId ?? "signer"];
    await this.repo.updateDocument(ctx.tenantId, id, { signatureStatus: "PENDING" });
    const challenge = this.signer.issueChallenge({ documentId: id, documentSha256: d.sha256, signers });
    // Notification SANS contenu : type + demande, jamais le corps du document.
    this.bus.publish(ctx.tenantId, "Document", id, "SignatureRequested", { signers: signers.length }, ctx.userId);
    return { document: await this.repo.getDocument(ctx.tenantId, id), challenge: { challengeId: challenge.challengeId, otp: process.env.NODE_ENV === "production" ? undefined : challenge.otp } };
  }

  /// Signature : vérifie l'OTP via le provider, conserve le certificat de preuve.
  async signDocument(ctx: Ctx, id: string, input: { otp?: string } = {}) {
    assertCan(ctx, "document.sign"); // séparation : signer ≠ déposer ≠ lire
    const d: any = await this.getDocument(ctx, id);
    if (d.signatureStatus === "SIGNED") throw new AppError(409, "conflict", "Document déjà signé");
    if (!input.otp) throw new AppError(400, "bad_request", "OTP requis pour signer");
    const now = new Date().toISOString();
    let cert;
    try {
      cert = this.signer.sign({ documentId: id, signerId: ctx.userId ?? "signer", documentSha256: d.sha256, otp: input.otp, now });
    } catch (e: any) {
      throw new AppError(400, "signature_failed", e.message);
    }
    const updated: any = await this.repo.updateDocument(ctx.tenantId, id, { signatureStatus: "SIGNED", status: "SIGNED", signedAt: cert.signedAt, signatureProof: cert.proof } as any);
    this.bus.publish(ctx.tenantId, "Document", id, "DocumentSigned", { signedAt: cert.signedAt, proof: cert.proof, eidasLevel: cert.eidasLevel }, ctx.userId);
    return updated;
  }

  /// Auto-signature par le collaborateur de SON propre document (espace self-service).
  /// Scopé au personId du jeton ; le document doit lui appartenir et être en attente.
  async signOwnDocument(ctx: Ctx, id: string) {
    assertCan(ctx, "document.sign.self");
    if (!ctx.personId) throw new AppError(403, "forbidden", "Réservé au collaborateur");
    const d: any = await this.repo.getDocument(ctx.tenantId, id);
    if (!d || d.personId !== ctx.personId) throw new AppError(404, "not_found", "Document introuvable");
    if (d.signatureStatus === "SIGNED") throw new AppError(409, "conflict", "Document déjà signé");
    if (d.signatureStatus !== "PENDING") throw new AppError(409, "conflict", "Aucune signature demandée");
    const now = new Date().toISOString();
    // Le collaborateur est authentifié (JWT) ; on émet+vérifie le défi en interne.
    const challenge = this.signer.issueChallenge({ documentId: id, documentSha256: d.sha256, signers: [ctx.personId] });
    const cert = this.signer.sign({ documentId: id, signerId: ctx.personId, documentSha256: d.sha256, otp: challenge.otp!, now });
    const updated = await this.repo.updateDocument(ctx.tenantId, id, { signatureStatus: "SIGNED", status: "SIGNED", signedAt: cert.signedAt, signatureProof: cert.proof } as any);
    this.bus.publish(ctx.tenantId, "Document", id, "DocumentSigned", { signedAt: cert.signedAt, proof: cert.proof, eidasLevel: cert.eidasLevel, selfSigned: true }, ctx.userId);
    return updated;
  }

  // --- Legal hold + DELETE / ANONYMIZE / ARCHIVE (opérations STRICTEMENT distinctes) ---
  async setLegalHold(ctx: Ctx, id: string, hold: boolean) {
    assertCan(ctx, "document.legal_hold");
    await this.getDocument(ctx, id);
    const updated = await this.repo.updateDocument(ctx.tenantId, id, { legalHold: hold });
    this.bus.publish(ctx.tenantId, "Document", id, hold ? "LegalHoldPlaced" : "LegalHoldReleased", {}, ctx.userId);
    return updated;
  }

  /// ARCHIVE : conservation (statut ARCHIVED), le coffre n'est JAMAIS détruit.
  archiveDocument(ctx: Ctx, id: string) { return this.transitionStatus(ctx, id, ["DRAFT", "REVIEW", "VALIDATED", "SIGNED", "PUBLISHED"], "ARCHIVED", "DocumentArchived"); }

  /// ANONYMIZE : retire les rattachements personnels (RGPD), CONSERVE l'enregistrement.
  async anonymizeDocument(ctx: Ctx, id: string) {
    assertCan(ctx, "document.delete");
    const d: any = await this.getDocument(ctx, id);
    if (d.legalHold) throw new AppError(409, "legal_hold", "Anonymisation bloquée : legal hold actif");
    const updated = await this.repo.updateDocument(ctx.tenantId, id, { personId: undefined as any, employmentId: undefined as any, label: "[anonymisé]", anonymizedAt: new Date().toISOString() });
    this.bus.publish(ctx.tenantId, "Document", id, "DocumentAnonymized", {}, ctx.userId);
    return updated;
  }

  /// DELETE : suppression physique — autorisée UNIQUEMENT si la rétention est
  /// échue ET aucun legal hold. Sinon refus (le legal hold prime).
  async deleteDocument(ctx: Ctx, id: string) {
    assertCan(ctx, "document.delete");
    const d: any = await this.getDocument(ctx, id);
    if (d.legalHold) throw new AppError(409, "legal_hold", "Suppression bloquée : legal hold actif");
    const today = new Date().toISOString().slice(0, 10);
    if (!d.retentionUntil || d.retentionUntil >= today) throw new AppError(409, "retention_active", "Suppression bloquée : durée de conservation non échue");
    // Suppression contrôlée = objet réellement retiré du stockage (Lot 19) + ligne registre.
    if (d.storageRef && !String(d.storageRef).startsWith("vault://")) {
      try { await this.docStore.delete(d.storageRef); } catch { /* best-effort : la ligne registre part quand même */ }
    }
    await this.repo.deleteDocument(ctx.tenantId, id);
    this.bus.publish(ctx.tenantId, "Document", id, "DocumentDeleted", { reason: "retention_expired" }, ctx.userId);
    return { deleted: true };
  }

  /// Génération par template : contrôle des données requises AVANT génération.
  async generateFromTemplate(ctx: Ctx, input: { personId?: string; employmentId?: string; type: DocumentType; label: string; template: string; context: Record<string, any> }) {
    assertCan(ctx, "document.write");
    const missing = missingVariables(input.template, input.context);
    if (missing.length) throw new AppError(422, "missing_information", `impossible : information manquante (${missing.join(", ")})`, { missing });
    const content = renderTemplate(input.template, input.context);
    return this.depositDocument(ctx, { personId: input.personId, employmentId: input.employmentId, type: input.type, label: input.label, content });
  }

  /// Archivage automatique des documents d'une personne (au départ du collaborateur).
  /// Le coffre n'est jamais détruit ; le collaborateur garde l'accès à ses documents.
  async archivePersonDocuments(tenantId: string, personId: string, actorUserId?: string) {
    const docs = await this.repo.listDocumentsByPerson(tenantId, personId);
    for (const d of docs) {
      if (d.status === "ARCHIVED") continue;
      await this.repo.updateDocument(tenantId, d.id, { status: "ARCHIVED" });
      this.bus.publish(tenantId, "Document", d.id, "DocumentArchived", { reason: "employee_departure" }, actorUserId);
    }
  }

  // ------------------- D3 — Temps : absences & congés ----------------------
  // Décompte OUVRABLES par défaut (hors dimanches/fériés/fermetures). Solde via
  // grand livre append-only. Workflow REQUESTED→MANAGER_APPROVED→APPROVED.
  async requestLeave(ctx: Ctx, employmentId: string, input: { type: LeaveType; startDate: string; endDate: string; reason?: string }) {
    assertCan(ctx, "leave.request");
    if (!(await this.repo.getEmployment(ctx.tenantId, employmentId))) throw new AppError(404, "not_found", "Employment introuvable");
    if (new Date(input.endDate) < new Date(input.startDate)) throw new AppError(400, "bad_request", "endDate antérieure à startDate");
    const days = countLeaveDays(input.startDate, input.endDate);
    const lr = { id: uid(), tenantId: ctx.tenantId, employmentId, type: input.type, startDate: input.startDate, endDate: input.endDate, days, status: "REQUESTED" as const, reason: input.reason };
    await this.repo.createLeaveRequest(lr);
    this.bus.publish(ctx.tenantId, "LeaveRequest", lr.id, "LeaveRequested", { type: lr.type, days }, ctx.userId);
    return lr;
  }

  /// Étape manager. Si l'étape RH n'est pas requise (config), finalise directement.
  async approveLeave(ctx: Ctx, id: string) {
    assertCan(ctx, "leave.approve");
    const lr = await this.repo.getLeaveRequest(ctx.tenantId, id);
    if (!lr) throw new AppError(404, "not_found", "Demande introuvable");
    if (lr.status !== "REQUESTED") throw new AppError(409, "conflict", `Étape manager impossible (statut ${lr.status})`);
    await this.repo.updateLeaveRequest(ctx.tenantId, id, { status: "MANAGER_APPROVED", managerApprovedBy: ctx.userId });
    this.bus.publish(ctx.tenantId, "LeaveRequest", id, "LeaveManagerApproved", { by: ctx.userId }, ctx.userId);
    if (!APPROVAL_POLICY.requiresHr) return this._finalizeLeave(ctx, id);
    return this.repo.getLeaveRequest(ctx.tenantId, id);
  }

  /// Étape RH (si requise par la configuration).
  async approveLeaveHr(ctx: Ctx, id: string) {
    assertCan(ctx, "leave.approve.hr");
    const lr = await this.repo.getLeaveRequest(ctx.tenantId, id);
    if (!lr) throw new AppError(404, "not_found", "Demande introuvable");
    if (lr.status !== "MANAGER_APPROVED") throw new AppError(409, "conflict", `Étape RH impossible (statut ${lr.status})`);
    return this._finalizeLeave(ctx, id);
  }

  private async _finalizeLeave(ctx: Ctx, id: string) {
    const lr = (await this.repo.getLeaveRequest(ctx.tenantId, id))!;
    if (LEAVE_TYPE_POLICY[lr.type]?.decremented) {
      const bal = await this.leaveBalance(ctx, lr.employmentId, lr.type);
      if (lr.days > bal.remaining) throw new AppError(409, "insufficient_balance", `Solde insuffisant (${bal.remaining} restants, ${lr.days} demandés)`);
      // Mouvement TAKEN daté (append-only) à la date d'effet de l'absence.
      await this.repo.createLeaveLedgerEntry({ id: uid(), tenantId: ctx.tenantId, employmentId: lr.employmentId, type: lr.type, kind: "TAKEN", days: lr.days, effectiveDate: lr.startDate, sourceRef: lr.id, createdBy: ctx.userId, createdAt: new Date().toISOString() });
    }
    const updated = await this.repo.updateLeaveRequest(ctx.tenantId, id, { status: "APPROVED", decidedBy: ctx.userId });
    // Consommé par le planning simple + la préparation de variables de paie.
    this.bus.publish(ctx.tenantId, "LeaveRequest", id, "LeaveApproved", { type: lr.type, days: lr.days, paid: !!LEAVE_TYPE_POLICY[lr.type]?.paid, effectiveDate: lr.startDate }, ctx.userId);
    return updated;
  }

  async refuseLeave(ctx: Ctx, id: string) {
    assertCan(ctx, "leave.approve");
    const lr = await this.repo.getLeaveRequest(ctx.tenantId, id);
    if (!lr) throw new AppError(404, "not_found", "Demande introuvable");
    if (!["REQUESTED", "MANAGER_APPROVED"].includes(lr.status)) throw new AppError(409, "conflict", `Demande déjà traitée (${lr.status})`);
    const updated = await this.repo.updateLeaveRequest(ctx.tenantId, id, { status: "REFUSED", decidedBy: ctx.userId });
    this.bus.publish(ctx.tenantId, "LeaveRequest", id, "LeaveRefused", { days: lr.days }, ctx.userId);
    return updated;
  }

  /// Compat : ancien point d'entrée unique (approve/refuse).
  decideLeave(ctx: Ctx, id: string, approve: boolean) { return approve ? this.approveLeave(ctx, id) : this.refuseLeave(ctx, id); }

  /// Correction de solde = NOUVELLE ligne append-only (jamais d'écrasement).
  async correctLeaveBalance(ctx: Ctx, employmentId: string, input: { type: LeaveType; days: number; effectiveDate: string; reason: string }) {
    assertCan(ctx, "leave.approve");
    if (!(await this.repo.getEmployment(ctx.tenantId, employmentId))) throw new AppError(404, "not_found", "Employment introuvable");
    const entry = { id: uid(), tenantId: ctx.tenantId, employmentId, type: input.type, kind: "CORRECTION" as const, days: input.days, effectiveDate: input.effectiveDate, reason: input.reason, createdBy: ctx.userId, createdAt: new Date().toISOString() };
    await this.repo.createLeaveLedgerEntry(entry);
    this.bus.publish(ctx.tenantId, "LeaveLedgerEntry", entry.id, "LeaveBalanceAdjusted", { kind: "CORRECTION", days: input.days }, ctx.userId);
    return entry;
  }

  /// Solde d'un type à une date (asOf). Sans asOf : sur toute la période courante
  /// (les congés approuvés de la période comptent). Rejoue le ledger jusqu'à asOf.
  async leaveBalance(ctx: Ctx, employmentId: string, type: LeaveType, asOf?: string) {
    const emp = await this.repo.getEmployment(ctx.tenantId, employmentId);
    if (!emp) throw new AppError(404, "not_found", "Employment introuvable");
    const today = new Date().toISOString().slice(0, 10);
    const effectiveAsOf = asOf ?? referencePeriod(today).end; // solde courant = fin de période
    const period = referencePeriod(effectiveAsOf);
    const acquired = acquiredDays(type, emp.startDate, emp.endDate, effectiveAsOf);
    const ledger = (await this.repo.listLeaveLedgerByEmployment(ctx.tenantId, employmentId))
      .filter((e) => e.type === type && e.effectiveDate >= period.start && e.effectiveDate <= effectiveAsOf);
    const taken = ledger.filter((e) => e.kind === "TAKEN").reduce((s, e) => s + e.days, 0);
    const corrections = ledger.filter((e) => e.kind === "CORRECTION").reduce((s, e) => s + e.days, 0);
    const pending = (await this.repo.listLeaveRequestsByEmployment(ctx.tenantId, employmentId))
      .filter((l) => l.type === type && ["REQUESTED", "MANAGER_APPROVED"].includes(l.status))
      .reduce((s, l) => s + l.days, 0);
    const remaining = acquired - taken + corrections;
    return { type, asOf: effectiveAsOf, acquired, taken, corrections, pending, remaining, allowance: acquired };
  }
}
