// D2b (Lot 11) — Identifiants sensibles (NIR/IBAN chiffrés, lecture auditée),
// coordonnées historisées (SCD-2), demandes de changement self-service.
// Droits appliqués AVANT agrégation ; deny by default ; toute lecture sensible
// est journalisée dans AuditLog (qui/quand/quoi/contexte). ADR-014 : nouveaux
// services, aucun service existant modifié.
import { uid } from "./store.js";
import { EventBus } from "./events.js";
import { Repository } from "./repository.js";
import { assertCan } from "./auth.js";
import { encrypt, decrypt, last4 } from "./crypto.js";
import { Ctx, AppError, AddressType, BankAccountStatus, SensitiveIdType, AuditLog } from "./types.js";

const today = () => new Date().toISOString().slice(0, 10);

export class SensitiveService {
  constructor(private repo: Repository, private bus: EventBus) {}

  /// Journalise une action dans AuditLog (qui/quand/quoi/avant/après/contexte).
  private async audit(ctx: Ctx, e: { action: string; entityType: string; entityId: string; before?: any; after?: any; reason?: string }) {
    const entry: AuditLog = { id: uid(), tenantId: ctx.tenantId, userId: ctx.userId, at: new Date().toISOString(), ip: (ctx as any).ip, ...e };
    await this.repo.appendAudit(entry);
    return entry;
  }

  /// Un collaborateur (jeton avec personId) ne voit que SES données sensibles.
  private assertOwnIfEmployee(ctx: Ctx, personId: string) {
    if (ctx.personId && ctx.personId !== personId) throw new AppError(404, "not_found", "Ressource introuvable");
  }

  // ----------------------- Coordonnées bancaires (IBAN) -----------------------
  async registerBankAccount(ctx: Ctx, personId: string, input: { iban: string; bic?: string; holderName?: string }) {
    assertCan(ctx, "bank_account.write");
    if (!input.iban) throw new AppError(400, "bad_request", "iban requis");
    // SCD-2 : la précédente valeur active est clôturée (REPLACED), jamais supprimée.
    for (const b of await this.repo.listBankAccountsByPerson(ctx.tenantId, personId)) {
      if (!b.validTo) await this.repo.updateBankAccount(ctx.tenantId, b.id, { validTo: today(), status: "REPLACED" });
    }
    const ba = { id: uid(), tenantId: ctx.tenantId, personId, ibanEnc: encrypt(input.iban), ibanLast4: last4(input.iban), bic: input.bic, holderName: input.holderName, status: "FURNISHED" as BankAccountStatus, validFrom: today() };
    await this.repo.createBankAccount(ba);
    this.bus.publish(ctx.tenantId, "BankAccount", ba.id, "BankAccountRegistered", { ibanLast4: ba.ibanLast4, status: ba.status }, ctx.userId);
    await this.audit(ctx, { action: "bank_account.write", entityType: "BankAccount", entityId: ba.id, after: { ibanLast4: ba.ibanLast4, status: ba.status } });
    return this.mask(ba);
  }

  /// Affichage MASQUÉ par défaut (ibanLast4) — jamais l'IBAN complet ni le chiffré.
  private mask(b: any) { return { id: b.id, personId: b.personId, ibanLast4: b.ibanLast4, bic: b.bic, holderName: b.holderName, status: b.status, validFrom: b.validFrom, validTo: b.validTo }; }

  async listBankAccounts(ctx: Ctx, personId: string) {
    assertCan(ctx, "bank_account.read");
    this.assertOwnIfEmployee(ctx, personId);
    return (await this.repo.listBankAccountsByPerson(ctx.tenantId, personId)).map((b) => this.mask(b));
  }

  /// Lecture de l'IBAN COMPLET (déchiffré) — sensible → JOURNALISÉE (scénario 15).
  async readIban(ctx: Ctx, bankAccountId: string) {
    assertCan(ctx, "bank_account.read");
    const b = await this.repo.getBankAccount(ctx.tenantId, bankAccountId);
    if (!b) throw new AppError(404, "not_found", "Coordonnées bancaires introuvables");
    this.assertOwnIfEmployee(ctx, b.personId);
    await this.audit(ctx, { action: "bank_account.read.iban", entityType: "BankAccount", entityId: b.id, reason: "consultation IBAN complet" });
    return { id: b.id, iban: decrypt(b.ibanEnc), status: b.status };
  }

  async setBankStatus(ctx: Ctx, bankAccountId: string, to: BankAccountStatus) {
    assertCan(ctx, "bank_account.write");
    const b = await this.repo.getBankAccount(ctx.tenantId, bankAccountId);
    if (!b) throw new AppError(404, "not_found", "Coordonnées bancaires introuvables");
    const T: Record<string, string[]> = { FURNISHED: ["TO_VERIFY", "REJECTED"], TO_VERIFY: ["VALIDATED", "REJECTED"], VALIDATED: ["REPLACED"], REJECTED: ["REPLACED"], REPLACED: [] };
    if (!(T[b.status] ?? []).includes(to)) throw new AppError(409, "conflict", `Transition IBAN invalide : ${b.status} → ${to}`);
    const updated = await this.repo.updateBankAccount(ctx.tenantId, b.id, { status: to });
    await this.audit(ctx, { action: "bank_account.status", entityType: "BankAccount", entityId: b.id, before: { status: b.status }, after: { status: to } });
    return this.mask(updated);
  }

  // -------------------------- Identifiants sensibles --------------------------
  async registerSensitiveId(ctx: Ctx, personId: string, input: { type: SensitiveIdType; value: string }) {
    assertCan(ctx, "person.sensitive.write");
    const s = { id: uid(), tenantId: ctx.tenantId, personId, type: input.type, valueEnc: encrypt(input.value), validFrom: today() };
    await this.repo.createSensitiveId(s);
    await this.audit(ctx, { action: "person.sensitive.write", entityType: "SensitiveIdentifier", entityId: s.id, after: { type: s.type } });
    return { id: s.id, personId, type: s.type, validFrom: s.validFrom };
  }

  /// Lecture de la valeur sensible (NIR…) — déchiffrée + JOURNALISÉE.
  async readSensitiveValue(ctx: Ctx, id: string) {
    assertCan(ctx, "person.sensitive.read");
    const s = await this.repo.getSensitiveId(ctx.tenantId, id);
    if (!s) throw new AppError(404, "not_found", "Identifiant introuvable");
    this.assertOwnIfEmployee(ctx, s.personId);
    await this.audit(ctx, { action: "person.sensitive.read", entityType: "SensitiveIdentifier", entityId: s.id, reason: `consultation ${s.type}` });
    return { id: s.id, type: s.type, value: decrypt(s.valueEnc) };
  }

  // -------------------------- Adresses (SCD-2) --------------------------------
  async registerAddress(ctx: Ctx, personId: string, input: { type?: AddressType; line1: string; line2?: string; postalCode: string; city: string; country?: string }, actor: "direct" | "change_request" = "direct") {
    if (actor === "direct") assertCan(ctx, "person.write");
    for (const a of await this.repo.listAddressesByPerson(ctx.tenantId, personId)) {
      if (!a.validTo) await this.repo.updateAddress(ctx.tenantId, a.id, { validTo: today() }); // clôturée, conservée
    }
    const addr = { id: uid(), tenantId: ctx.tenantId, personId, type: input.type ?? "HOME" as AddressType, line1: input.line1, line2: input.line2, postalCode: input.postalCode, city: input.city, country: input.country ?? "FR", validFrom: today() };
    await this.repo.createAddress(addr);
    this.bus.publish(ctx.tenantId, "Person", personId, "AddressChanged", { validFrom: addr.validFrom }, ctx.userId);
    await this.audit(ctx, { action: "address.change", entityType: "Address", entityId: addr.id, after: { city: addr.city, postalCode: addr.postalCode } });
    return addr;
  }

  async listAddresses(ctx: Ctx, personId: string) {
    assertCan(ctx, "person.read");
    this.assertOwnIfEmployee(ctx, personId);
    return this.repo.listAddressesByPerson(ctx.tenantId, personId);
  }

  // --------------------- Demandes de changement (self-service) ----------------
  /// Le collaborateur SOUMET une demande (jamais d'UPDATE direct).
  async submitChangeRequest(ctx: Ctx, input: { field: string; value: any; employmentId?: string }) {
    assertCan(ctx, "change_request.submit");
    if (!ctx.personId) throw new AppError(403, "forbidden", "Réservé au collaborateur");
    const cr = { id: uid(), tenantId: ctx.tenantId, personId: ctx.personId, employmentId: input.employmentId, field: input.field, requestedValue: input.value, status: "REQUESTED" as const, createdAt: new Date().toISOString() };
    await this.repo.createChangeRequest(cr);
    this.bus.publish(ctx.tenantId, "ChangeRequest", cr.id, "ChangeRequestSubmitted", { field: cr.field }, ctx.userId);
    await this.audit(ctx, { action: "change_request.submit", entityType: "ChangeRequest", entityId: cr.id, after: { field: cr.field } });
    return cr;
  }

  async listMyChangeRequests(ctx: Ctx) {
    if (!ctx.personId) throw new AppError(403, "forbidden", "Réservé au collaborateur");
    return this.repo.listChangeRequestsByPerson(ctx.tenantId, ctx.personId);
  }

  async listPendingChangeRequests(ctx: Ctx) {
    assertCan(ctx, "change_request.validate");
    return (await this.repo.listChangeRequestsByTenant(ctx.tenantId)).filter((c) => c.status === "REQUESTED");
  }

  /// VALIDATION RH → applique le changement (UPDATE + événement + audit), ou refus motivé.
  async decideChangeRequest(ctx: Ctx, id: string, approve: boolean, reason?: string) {
    assertCan(ctx, "change_request.validate");
    const cr = await this.repo.getChangeRequest(ctx.tenantId, id);
    if (!cr) throw new AppError(404, "not_found", "Demande introuvable");
    if (cr.status !== "REQUESTED") throw new AppError(409, "conflict", `Demande déjà traitée (${cr.status})`);
    if (!approve) {
      const refused = await this.repo.updateChangeRequest(ctx.tenantId, id, { status: "REFUSED", decidedBy: ctx.userId, reason });
      this.bus.publish(ctx.tenantId, "ChangeRequest", id, "ChangeRequestRefused", { reason }, ctx.userId);
      await this.audit(ctx, { action: "change_request.refuse", entityType: "ChangeRequest", entityId: id, reason });
      return refused;
    }
    // Application contrôlée du changement.
    if (cr.field === "address") await this.registerAddress(ctx, cr.personId, cr.requestedValue, "change_request");
    else throw new AppError(422, "unsupported_field", `Champ non pris en charge en self-service : ${cr.field}`);
    const applied = await this.repo.updateChangeRequest(ctx.tenantId, id, { status: "APPROVED", decidedBy: ctx.userId });
    this.bus.publish(ctx.tenantId, "ChangeRequest", id, "ChangeRequestApproved", { field: cr.field }, ctx.userId);
    await this.audit(ctx, { action: "change_request.approve", entityType: "ChangeRequest", entityId: id, after: { field: cr.field } });
    return applied;
  }

  async listAudit(ctx: Ctx) {
    assertCan(ctx, "audit.read");
    return this.repo.listAuditByTenant(ctx.tenantId);
  }
}
