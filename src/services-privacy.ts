// Rhéos — Droits des personnes (Lot 17, RGPD). Deux opérations :
//  1) Droit d'accès (art. 15) : export COMPLET des données d'une personne (JSON + PDF),
//     journalisé, sur habilitation RH. Complète l'export miroir du Lot 16.
//  2) Anonymisation en fin de rétention : branche la mécanique DELETE/ANONYMIZE/ARCHIVE
//     existante (documents) + purge des valeurs sensibles chiffrées (IBAN/NIR) + identité.
import { uid } from "./store.js";
import { EventBus } from "./events.js";
import { Repository } from "./repository.js";
import { MvpServices } from "./services-mvp.js";
import { assertCan } from "./auth.js";
import { buildPdf, PdfSection } from "./domain/pdf.js";
import { Ctx, AppError } from "./types.js";

const today = () => new Date().toISOString().slice(0, 10);

export class PrivacyService {
  constructor(private repo: Repository, private bus: EventBus, private mvp: MvpServices) {}

  /// Droit d'accès (art. 15) : assemble toutes les données de la personne. Les valeurs
  /// sensibles chiffrées (NIR/IBAN) sont MASQUÉES ici (communiquées séparément sur
  /// demande vérifiée) — l'export ne réexpose jamais un secret en clair. Journalisé.
  async accessRequest(ctx: Ctx, personId: string) {
    assertCan(ctx, "person.read");
    const person = await this.repo.getPerson(ctx.tenantId, personId);
    if (!person) throw new AppError(404, "not_found", "Personne introuvable");

    const emps = (await this.repo.listEmploymentsByTenant(ctx.tenantId)).filter((e) => e.personId === personId);
    const employments = [];
    for (const e of emps) {
      employments.push({
        employment: e,
        contracts: await this.repo.listContractsByEmployment(ctx.tenantId, e.id),
        assignments: await this.repo.listAssignmentsByEmployment(ctx.tenantId, e.id),
        hrEvents: await this.repo.listHrEventsByEmployment(ctx.tenantId, e.id),
        leaves: await this.repo.listLeaveRequestsByEmployment(ctx.tenantId, e.id),
        shifts: await this.repo.listShiftsByEmployment(ctx.tenantId, e.id),
        timeEntries: await this.repo.listTimeEntriesByEmployment(ctx.tenantId, e.id),
      });
    }
    const addresses = await this.repo.listAddressesByPerson(ctx.tenantId, personId);
    const bankAccounts = (await this.repo.listBankAccountsByPerson(ctx.tenantId, personId)).map((b) => ({
      id: b.id, ibanMasque: `**** **** **** ${b.ibanLast4 || "----"}`, bic: b.bic, holderName: b.holderName, status: b.status, validFrom: b.validFrom, validTo: b.validTo,
    }));
    const sensitiveIds = (await this.repo.listSensitiveIdsByPerson(ctx.tenantId, personId)).map((s) => ({
      id: s.id, type: s.type, valeur: "[chiffrée — communiquée séparément sur demande vérifiée]", validFrom: s.validFrom, validTo: s.validTo,
    }));
    const documents = (await this.repo.listDocumentsByPerson(ctx.tenantId, personId)).map((d) => ({
      id: d.id, type: d.type, label: d.label, status: d.status, createdAt: d.createdAt, retentionUntil: d.retentionUntil, sha256: d.sha256,
    }));
    const changeRequests = await this.repo.listChangeRequestsByPerson(ctx.tenantId, personId);
    const audit = (await this.repo.listAuditByTenant(ctx.tenantId))
      .filter((a) => a.entityId === personId || (a.entityType === "Person" && a.entityId === personId))
      .map((a) => ({ action: a.action, at: a.at, by: a.userId }));

    const data = {
      generatedAt: new Date().toISOString(), tenantId: ctx.tenantId,
      subject: { id: person.id, lastName: person.lastName, firstName: person.firstName, usageName: person.usageName, birthDate: person.birthDate, personalEmail: person.personalEmail },
      employments, addresses, bankAccounts, sensitiveIds, documents, changeRequests, audit,
      notice: "Export au titre du droit d'accès (RGPD art. 15). Les valeurs sensibles chiffrées (NIR/IBAN) sont communiquées séparément sur demande vérifiée ; elles ne sont jamais réexposées en clair dans ce document.",
    };
    // Journalisation obligatoire (qui, quand, sur qui) + événement.
    await this.repo.appendAudit({ id: uid(), tenantId: ctx.tenantId, userId: ctx.userId, action: "person.access_request", entityType: "Person", entityId: personId, at: new Date().toISOString() });
    this.bus.publish(ctx.tenantId, "Person", personId, "PersonDataAccessRequested", {}, ctx.userId);
    return data;
  }

  /// Variante PDF (art. 15) — même contenu, format imprimable.
  async accessRequestPdf(ctx: Ctx, personId: string): Promise<Buffer> {
    const d = await this.accessRequest(ctx, personId);
    const kv = (k: string, v: any) => `${k} : ${v === null || v === undefined || v === "" ? "—" : v}`;
    const sections: PdfSection[] = [];
    sections.push({ heading: "Identité", lines: [
      kv("Nom", d.subject.lastName), kv("Prénom", d.subject.firstName), kv("Nom d'usage", d.subject.usageName),
      kv("Date de naissance", d.subject.birthDate), kv("Email personnel", d.subject.personalEmail), kv("Identifiant interne", d.subject.id),
    ] });
    d.employments.forEach((e, i) => sections.push({ heading: `Relation de travail ${i + 1}`, lines: [
      kv("Statut", e.employment.status), kv("Entrée", e.employment.startDate), kv("Sortie", e.employment.endDate),
      ...e.contracts.map((c: any) => kv("Contrat", `${c.type} ${c.status} depuis ${c.startDate}${c.grossMonthly ? ` — ${c.grossMonthly} EUR` : ""}`)),
      ...e.leaves.map((l: any) => kv("Congé", `${l.type} ${l.startDate}→${l.endDate} (${l.days} j) ${l.status}`)),
      kv("Créneaux planifiés", e.shifts.length), kv("Pointages", e.timeEntries.length),
    ] }));
    if (d.addresses.length) sections.push({ heading: "Adresses", lines: d.addresses.map((a: any) => kv(a.type, `${a.line1}, ${a.postalCode} ${a.city} (${a.validFrom}${a.validTo ? `→${a.validTo}` : ""})`)) });
    if (d.bankAccounts.length) sections.push({ heading: "Coordonnées bancaires", lines: d.bankAccounts.map((b) => kv("IBAN", `${b.ibanMasque} — ${b.status}`)) });
    if (d.sensitiveIds.length) sections.push({ heading: "Identifiants sensibles", lines: d.sensitiveIds.map((s) => kv(s.type, s.valeur)) });
    if (d.documents.length) sections.push({ heading: "Documents (coffre-fort)", lines: d.documents.map((x) => kv(x.type, `${x.label} [${x.status}] rétention → ${x.retentionUntil || "—"}`)) });
    sections.push({ heading: "Journal d'accès (audit)", lines: d.audit.length ? d.audit.map((a) => `${a.at} — ${a.action} (${a.by || "?"})`) : ["—"] });
    sections.push({ heading: "Mentions", lines: [d.notice, `Export généré le ${d.generatedAt}.`] });
    return buildPdf("Rheos — Export « droit d'acces » (RGPD art. 15)", sections);
  }

  /// Anonymisation en fin de rétention : purge de l'identité + valeurs sensibles
  /// chiffrées + anonymisation des documents (mécanique existante). Refuse si une
  /// relation de travail est encore active. Événement + journal d'audit.
  async anonymizePerson(ctx: Ctx, personId: string) {
    assertCan(ctx, "person.write");
    const person = await this.repo.getPerson(ctx.tenantId, personId);
    if (!person) throw new AppError(404, "not_found", "Personne introuvable");
    const emps = (await this.repo.listEmploymentsByTenant(ctx.tenantId)).filter((e) => e.personId === personId);
    if (emps.some((e) => !["ENDED", "ARCHIVED"].includes(e.status))) {
      throw new AppError(409, "active_employment", "Anonymisation impossible : une relation de travail est encore active (attendre la fin de rétention).");
    }
    const d = today();
    await this.repo.updatePerson(ctx.tenantId, personId, { lastName: "ANONYMISÉ", firstName: "ANONYMISÉ", usageName: undefined, birthDate: undefined, personalEmail: undefined });
    let banks = 0;
    for (const b of await this.repo.listBankAccountsByPerson(ctx.tenantId, personId)) {
      await this.repo.updateBankAccount(ctx.tenantId, b.id, { ibanEnc: "", ibanLast4: "", bic: undefined, holderName: "ANONYMISÉ", status: "REPLACED", validTo: d });
      banks++;
    }
    let ids = 0;
    for (const s of await this.repo.listSensitiveIdsByPerson(ctx.tenantId, personId)) {
      await this.repo.updateSensitiveId(ctx.tenantId, s.id, { valueEnc: "", validTo: d });
      ids++;
    }
    let documents = 0, documentsHeld = 0;
    for (const doc of await this.repo.listDocumentsByPerson(ctx.tenantId, personId)) {
      try { await this.mvp.anonymizeDocument(ctx, doc.id); documents++; }
      catch { documentsHeld++; } // legal hold actif → conservé (l'anonymisation s'arrête là pour ce document)
    }
    const summary = { banks, sensitiveIds: ids, documents, documentsHeld };
    await this.repo.appendAudit({ id: uid(), tenantId: ctx.tenantId, userId: ctx.userId, action: "person.anonymize", entityType: "Person", entityId: personId, after: summary, at: new Date().toISOString() });
    this.bus.publish(ctx.tenantId, "Person", personId, "PersonAnonymized", summary, ctx.userId);
    return { personId, anonymized: true, ...summary };
  }
}
