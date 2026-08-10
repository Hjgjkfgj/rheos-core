// Implémentation Prisma/PostgreSQL du port Repository (ADR-014, chemin production).
// Isolation : filtre systématique par tenantId (niveau applicatif) + RLS (niveau BDD,
// voir prisma/migrations/0001_init/rls.sql). Chaque opération s'exécute dans une
// transaction qui pose `SET LOCAL app.tenant_id` pour activer la policy.
//
// Prérequis (machine avec réseau) :
//   npm i @prisma/client && npx prisma generate && npx prisma db push
//   psql "$DATABASE_URL_ADMIN" -f prisma/migrations/0001_init/rls.sql
import type { PrismaClient } from "@prisma/client";
import { Repository } from "./repository.js";
import {
  LegalEntity, Establishment, OperatingSite, Position, Person, Employment,
  Contract, Assignment, Doc, HrEvent, DomainEvent, LeaveRequest, LeaveType, Obligation,
  Shift, TimeEntry, ContractAmendment, Deadline, CseMandate, CseMeeting, AuthorityInteraction,
  Risk, WorkAccident, Competency, Training, CareerReview, Budget, Negotiation,
  Agreement, WorkforceSnapshot, LeaveLedgerEntry, AiAuditLog,
  Address, BankAccount, SensitiveIdentifier, AuditLog, ChangeRequest,
} from "./types.js";

// --- ÉCRITURE : domaine (string) → Prisma (DateTime) -------------------------
// Le domaine manipule des dates au format "YYYY-MM-DD" ; Prisma attend des
// DateTime. On convertit les dates seules en Date (minuit UTC). Les ISO complets
// (avec "T") sont acceptés tels quels par Prisma.
const isDateOnly = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
function norm<T extends Record<string, any>>(o: T): T {
  const r: any = {};
  for (const k in o) r[k] = isDateOnly(o[k]) ? new Date(o[k] + "T00:00:00Z") : o[k];
  return r;
}

// --- LECTURE : Prisma → domaine (PARITÉ avec le store mémoire) ----------------
// Convertit chaque valeur lue au format exact du MemoryRepository :
//   Date (champ « date seule ») → "YYYY-MM-DD" ; Date (horodatage) → ISO complet ;
//   Decimal → number ; null → undefined. Appliqué UNIFORMÉMENT dans tx().
const DATE_ONLY = new Set([
  "startDate", "endDate", "birthDate", "validFrom", "validTo", "effectiveDate",
  "effectiveFrom", "effectiveTo", "asOfDate", "closureDate", "deadline", "dueDate",
  "date", "periodStart", "periodEnd",
]);
function denorm(v: any, key?: string): any {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) { const iso = v.toISOString(); return key && DATE_ONLY.has(key) ? iso.slice(0, 10) : iso; }
  if (Array.isArray(v)) return v.map((x) => denorm(x));
  if (typeof v === "object") {
    if (typeof (v as any).toNumber === "function" && (v as any).constructor?.name === "Decimal") return (v as any).toNumber();
    const out: any = {};
    for (const k in v) out[k] = denorm((v as any)[k], k);
    return out;
  }
  return v;
}

export class PrismaRepository implements Repository {
  constructor(private prisma: PrismaClient) {}

  /// Exécute fn dans une transaction avec le tenant courant posé pour la RLS.
  /// SET du tenant via set_config(..., is_local=true) → PARAMÉTRÉ (anti-injection)
  /// et scopé à la transaction (équivaut à SET LOCAL). Le résultat est dénormalisé
  /// pour garantir la parité de forme avec le MemoryRepository.
  private tx(tenantId: string, fn: (px: any) => Promise<any>): Promise<any> {
    return this.prisma.$transaction(async (px: any) => {
      await px.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return denorm(await fn(px));
    });
  }

  // D1
  sirenExists(t: string, siren: string) { return this.tx(t, async (px) => (await px.legalEntity.count({ where: { tenantId: t, siren } })) > 0); }
  createLegalEntity(r: LegalEntity) { return this.tx(r.tenantId, (px) => px.legalEntity.create({ data: norm(r) })); }
  getLegalEntity(t: string, id: string) { return this.tx(t, (px) => px.legalEntity.findFirst({ where: { id, tenantId: t } })) as any; }
  listLegalEntities(t: string) { return this.tx(t, (px) => px.legalEntity.findMany({ where: { tenantId: t } })) as any; }
  siretExists(t: string, siret: string) { return this.tx(t, async (px) => (await px.establishment.count({ where: { tenantId: t, siret } })) > 0); }
  createEstablishment(r: Establishment) { return this.tx(r.tenantId, (px) => px.establishment.create({ data: norm(r) })); }
  getEstablishment(t: string, id: string) { return this.tx(t, (px) => px.establishment.findFirst({ where: { id, tenantId: t } })) as any; }
  updateEstablishment(t: string, id: string, patch: Partial<Establishment>) { return this.tx(t, (px) => px.establishment.update({ where: { id }, data: norm(patch) })) as any; }
  listEstablishmentsByCompany(t: string, companyId: string) { return this.tx(t, (px) => px.establishment.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }
  createOperatingSite(r: OperatingSite) { return this.tx(r.tenantId, (px) => px.operatingSite.create({ data: norm(r) })); }
  createPosition(r: Position) { return this.tx(r.tenantId, (px) => px.position.create({ data: norm(r) })); }
  getPosition(t: string, id: string) { return this.tx(t, (px) => px.position.findFirst({ where: { id, tenantId: t } })) as any; }
  createAgreement(r: Agreement) { return this.tx(r.tenantId, (px) => px.agreement.create({ data: norm(r) })); }
  listAgreementsByCompany(t: string, companyId: string) { return this.tx(t, (px) => px.agreement.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }
  createWorkforceSnapshot(r: WorkforceSnapshot) { return this.tx(r.tenantId, (px) => px.workforceSnapshot.create({ data: norm(r) })); }
  listWorkforceSnapshotsByCompany(t: string, companyId: string) { return this.tx(t, (px) => px.workforceSnapshot.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }

  // D2
  createPerson(r: Person) { return this.tx(r.tenantId, (px) => px.person.create({ data: norm(r) })); }
  getPerson(t: string, id: string) { return this.tx(t, (px) => px.person.findFirst({ where: { id, tenantId: t } })) as any; }
  findPersonDuplicates(t: string, lastName: string, firstName: string, birthDate?: string) {
    return this.tx(t, (px) => px.person.findMany({ where: { tenantId: t, lastName: { equals: lastName, mode: "insensitive" }, firstName: { equals: firstName, mode: "insensitive" }, ...(birthDate ? { birthDate: new Date(birthDate) } : {}) } })) as any;
  }
  createEmployment(r: Employment) { return this.tx(r.tenantId, (px) => px.employment.create({ data: norm(r) })); }
  getEmployment(t: string, id: string) { return this.tx(t, (px) => px.employment.findFirst({ where: { id, tenantId: t } })) as any; }
  findActiveEmploymentByPerson(t: string, personId: string) { return this.tx(t, (px) => px.employment.findFirst({ where: { tenantId: t, personId, status: { not: "ENDED" } } })) as any; }
  updateEmployment(t: string, id: string, patch: Partial<Employment>) { return this.tx(t, (px) => px.employment.update({ where: { id }, data: norm(patch) })) as any; }
  listEmploymentsByCompany(t: string, companyId: string) { return this.tx(t, (px) => px.employment.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }
  createContract(r: Contract) { return this.tx(r.tenantId, (px) => px.contract.create({ data: norm(r) })); }
  getContract(t: string, id: string) { return this.tx(t, (px) => px.contract.findFirst({ where: { id, tenantId: t } })) as any; }
  updateContract(t: string, id: string, patch: Partial<Contract>) { return this.tx(t, (px) => px.contract.update({ where: { id }, data: norm(patch) })) as any; }
  listContractsByEmployment(t: string, employmentId: string) { return this.tx(t, (px) => px.contract.findMany({ where: { tenantId: t, employmentId } })) as any; }
  createAmendment(r: ContractAmendment) { return this.tx(r.tenantId, (px) => px.contractAmendment.create({ data: norm(r) })); }
  getAmendment(t: string, id: string) { return this.tx(t, (px) => px.contractAmendment.findFirst({ where: { id, tenantId: t } })) as any; }
  updateAmendment(t: string, id: string, patch: Partial<ContractAmendment>) { return this.tx(t, (px) => px.contractAmendment.update({ where: { id }, data: norm(patch) })) as any; }
  listAmendmentsByContract(t: string, contractId: string) { return this.tx(t, (px) => px.contractAmendment.findMany({ where: { tenantId: t, contractId } })) as any; }
  createAssignment(r: Assignment) { return this.tx(r.tenantId, (px) => px.assignment.create({ data: norm(r) })); }
  updateAssignment(t: string, id: string, patch: Partial<Assignment>) { return this.tx(t, (px) => px.assignment.update({ where: { id }, data: norm(patch) })) as any; }
  listAssignmentsByEmployment(t: string, employmentId: string) { return this.tx(t, (px) => px.assignment.findMany({ where: { tenantId: t, employmentId } })) as any; }
  appendHrEvent(r: HrEvent) { return this.tx(r.tenantId, (px) => px.hrEvent.create({ data: norm(r) })); }
  listHrEventsByEmployment(t: string, employmentId: string) { return this.tx(t, (px) => px.hrEvent.findMany({ where: { tenantId: t, employmentId } })) as any; }

  // D10
  createDocument(r: Doc) { const data: any = norm(r as any); delete data.sealed; return this.tx(r.tenantId, (px) => px.document.create({ data })); }
  getDocument(t: string, id: string) { return this.tx(t, (px) => px.document.findFirst({ where: { id, tenantId: t } })) as any; }
  updateDocument(t: string, id: string, patch: Partial<Doc>) { const data: any = norm(patch as any); delete data.sealed; return this.tx(t, (px) => px.document.update({ where: { id }, data })) as any; }
  async deleteDocument(t: string, id: string) { const r: any = await this.tx(t, (px) => px.document.deleteMany({ where: { id, tenantId: t } })); return r.count > 0; }
  listDocumentsByPerson(t: string, personId: string) { return this.tx(t, (px) => px.document.findMany({ where: { tenantId: t, personId } })) as any; }

  // D3 — Planning & pointage
  createShift(r: Shift) { return this.tx(r.tenantId, (px) => px.shift.create({ data: norm(r) })); }
  listShiftsByEmployment(t: string, employmentId: string) { return this.tx(t, (px) => px.shift.findMany({ where: { tenantId: t, employmentId } })) as any; }
  createTimeEntry(r: TimeEntry) { return this.tx(r.tenantId, (px) => px.timeEntry.create({ data: norm(r) })); }
  listTimeEntriesByEmployment(t: string, employmentId: string) { return this.tx(t, (px) => px.timeEntry.findMany({ where: { tenantId: t, employmentId } })) as any; }
  // D3 — Congés
  createLeaveRequest(r: LeaveRequest) { return this.tx(r.tenantId, (px) => px.leaveRequest.create({ data: norm(r) })); }
  getLeaveRequest(t: string, id: string) { return this.tx(t, (px) => px.leaveRequest.findFirst({ where: { id, tenantId: t } })) as any; }
  updateLeaveRequest(t: string, id: string, patch: Partial<LeaveRequest>) { return this.tx(t, (px) => px.leaveRequest.update({ where: { id }, data: norm(patch) })) as any; }
  listApprovedLeaves(t: string, employmentId: string, type: LeaveType) { return this.tx(t, (px) => px.leaveRequest.findMany({ where: { tenantId: t, employmentId, type, status: "APPROVED" } })) as any; }
  listApprovedLeavesByEmployment(t: string, employmentId: string) { return this.tx(t, (px) => px.leaveRequest.findMany({ where: { tenantId: t, employmentId, status: "APPROVED" } })) as any; }
  listLeaveRequestsByEmployment(t: string, employmentId: string) { return this.tx(t, (px) => px.leaveRequest.findMany({ where: { tenantId: t, employmentId } })) as any; }
  createLeaveLedgerEntry(r: LeaveLedgerEntry) { return this.tx(r.tenantId, (px) => px.leaveLedgerEntry.create({ data: norm(r) })); }
  listLeaveLedgerByEmployment(t: string, employmentId: string) { return this.tx(t, (px) => px.leaveLedgerEntry.findMany({ where: { tenantId: t, employmentId } })) as any; }

  // D1 — Obligations
  createObligation(r: Obligation) { return this.tx(r.tenantId, (px) => px.obligation.create({ data: norm(r) })); }
  getObligation(t: string, id: string) { return this.tx(t, (px) => px.obligation.findFirst({ where: { id, tenantId: t } })) as any; }
  updateObligation(t: string, id: string, patch: Partial<Obligation>) { return this.tx(t, (px) => px.obligation.update({ where: { id }, data: norm(patch) })) as any; }
  listObligations(t: string, companyId: string) { return this.tx(t, (px) => px.obligation.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }

  // D8 — CSE
  createMandate(r: CseMandate) { return this.tx(r.tenantId, (px) => px.cseMandate.create({ data: norm(r) })); }
  listMandatesByCompany(t: string, companyId: string) { return this.tx(t, (px) => px.cseMandate.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }
  createMeeting(r: CseMeeting) { return this.tx(r.tenantId, (px) => px.cseMeeting.create({ data: norm(r) })); }
  getMeeting(t: string, id: string) { return this.tx(t, (px) => px.cseMeeting.findFirst({ where: { id, tenantId: t } })) as any; }
  updateMeeting(t: string, id: string, patch: Partial<CseMeeting>) { return this.tx(t, (px) => px.cseMeeting.update({ where: { id }, data: norm(patch) })) as any; }
  listMeetingsByCompany(t: string, companyId: string) { return this.tx(t, (px) => px.cseMeeting.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }
  createNegotiation(r: Negotiation) { return this.tx(r.tenantId, (px) => px.negotiation.create({ data: norm(r) })); }
  getNegotiation(t: string, id: string) { return this.tx(t, (px) => px.negotiation.findFirst({ where: { id, tenantId: t } })) as any; }
  updateNegotiation(t: string, id: string, patch: Partial<Negotiation>) { return this.tx(t, (px) => px.negotiation.update({ where: { id }, data: norm(patch) })) as any; }
  listNegotiationsByCompany(t: string, companyId: string) { return this.tx(t, (px) => px.negotiation.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }
  // D5 — Pilotage financier
  createBudget(r: Budget) { return this.tx(r.tenantId, (px) => px.budget.create({ data: norm(r) })); }
  listBudgetsByCompany(t: string, companyId: string) { return this.tx(t, (px) => px.budget.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }
  getBudgetByYear(t: string, companyId: string, year: number) { return this.tx(t, (px) => px.budget.findFirst({ where: { tenantId: t, legalEntityId: companyId, year }, orderBy: { version: "desc" } })) as any; }
  // D7 — Carrière & Formation
  createCompetency(r: Competency) { return this.tx(r.tenantId, (px) => px.competency.create({ data: norm(r) })); }
  listCompetenciesByEmployment(t: string, employmentId: string) { return this.tx(t, (px) => px.competency.findMany({ where: { tenantId: t, employmentId } })) as any; }
  createTraining(r: Training) { return this.tx(r.tenantId, (px) => px.training.create({ data: norm(r) })); }
  getTraining(t: string, id: string) { return this.tx(t, (px) => px.training.findFirst({ where: { id, tenantId: t } })) as any; }
  updateTraining(t: string, id: string, patch: Partial<Training>) { return this.tx(t, (px) => px.training.update({ where: { id }, data: norm(patch) })) as any; }
  listTrainingsByCompany(t: string, companyId: string) { return this.tx(t, (px) => px.training.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }
  createReview(r: CareerReview) { return this.tx(r.tenantId, (px) => px.careerReview.create({ data: norm(r) })); }
  getReview(t: string, id: string) { return this.tx(t, (px) => px.careerReview.findFirst({ where: { id, tenantId: t } })) as any; }
  updateReview(t: string, id: string, patch: Partial<CareerReview>) { return this.tx(t, (px) => px.careerReview.update({ where: { id }, data: norm(patch) })) as any; }
  listReviewsByEmployment(t: string, employmentId: string) { return this.tx(t, (px) => px.careerReview.findMany({ where: { tenantId: t, employmentId } })) as any; }
  // D6 — Santé & Prévention
  createRisk(r: Risk) { return this.tx(r.tenantId, (px) => px.risk.create({ data: norm(r) })); }
  getRisk(t: string, id: string) { return this.tx(t, (px) => px.risk.findFirst({ where: { id, tenantId: t } })) as any; }
  updateRisk(t: string, id: string, patch: Partial<Risk>) { return this.tx(t, (px) => px.risk.update({ where: { id }, data: norm(patch) })) as any; }
  listRisksByCompany(t: string, companyId: string) { return this.tx(t, (px) => px.risk.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }
  createAccident(r: WorkAccident) { return this.tx(r.tenantId, (px) => px.workAccident.create({ data: norm(r) })); }
  listAccidentsByCompany(t: string, companyId: string) { return this.tx(t, (px) => px.workAccident.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }
  // D9 — Autorités
  createInteraction(r: AuthorityInteraction) { return this.tx(r.tenantId, (px) => px.authorityInteraction.create({ data: norm(r) })); }
  getInteraction(t: string, id: string) { return this.tx(t, (px) => px.authorityInteraction.findFirst({ where: { id, tenantId: t } })) as any; }
  updateInteraction(t: string, id: string, patch: Partial<AuthorityInteraction>) { return this.tx(t, (px) => px.authorityInteraction.update({ where: { id }, data: norm(patch) })) as any; }
  listInteractionsByCompany(t: string, companyId: string) { return this.tx(t, (px) => px.authorityInteraction.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }
  // Veille & échéances
  createDeadline(r: Deadline) { return this.tx(r.tenantId, (px) => px.deadline.create({ data: norm(r) })); }
  listDeadlinesByCompany(t: string, companyId: string) { return this.tx(t, (px) => px.deadline.findMany({ where: { tenantId: t, legalEntityId: companyId } })) as any; }
  listDeadlinesByTenant(t: string) { return this.tx(t, (px) => px.deadline.findMany({ where: { tenantId: t } })) as any; }
  updateDeadline(t: string, id: string, patch: Partial<Deadline>) { return this.tx(t, (px) => px.deadline.update({ where: { id }, data: norm(patch) })) as any; }

  // Scans tenant-wide
  listContractsByTenant(t: string) { return this.tx(t, (px) => px.contract.findMany({ where: { tenantId: t } })) as any; }
  listLeaveRequestsByTenant(t: string) { return this.tx(t, (px) => px.leaveRequest.findMany({ where: { tenantId: t } })) as any; }
  listDocumentsByTenant(t: string) { return this.tx(t, (px) => px.document.findMany({ where: { tenantId: t } })) as any; }
  listObligationsByTenant(t: string) { return this.tx(t, (px) => px.obligation.findMany({ where: { tenantId: t } })) as any; }
  listEmploymentsByTenant(t: string) { return this.tx(t, (px) => px.employment.findMany({ where: { tenantId: t } })) as any; }

  // Événements
  async appendDomainEvent(e: DomainEvent) { await this.tx(e.tenantId, (px) => px.domainEvent.create({ data: norm(e) })); }
  listDomainEventsByTenant(t: string) { return this.tx(t, (px) => px.domainEvent.findMany({ where: { tenantId: t }, orderBy: { occurredAt: "desc" }, take: 200 })) as any; }
  async ping() { try { await this.prisma.$queryRawUnsafe("SELECT 1"); return true; } catch { return false; } }
  async appendAiAudit(e: AiAuditLog) { await this.tx(e.tenantId, (px) => px.aiAuditLog.create({ data: norm(e) })); }
  listAiAuditByTenant(t: string) { return this.tx(t, (px) => px.aiAuditLog.findMany({ where: { tenantId: t }, orderBy: { at: "desc" }, take: 200 })) as any; }

  // D2b
  createAddress(r: Address) { return this.tx(r.tenantId, (px) => px.address.create({ data: norm(r) })); }
  getAddress(t: string, id: string) { return this.tx(t, (px) => px.address.findFirst({ where: { id, tenantId: t } })) as any; }
  updateAddress(t: string, id: string, patch: Partial<Address>) { return this.tx(t, (px) => px.address.update({ where: { id }, data: norm(patch) })) as any; }
  listAddressesByPerson(t: string, personId: string) { return this.tx(t, (px) => px.address.findMany({ where: { tenantId: t, personId } })) as any; }
  createBankAccount(r: BankAccount) { return this.tx(r.tenantId, (px) => px.bankAccount.create({ data: norm(r) })); }
  getBankAccount(t: string, id: string) { return this.tx(t, (px) => px.bankAccount.findFirst({ where: { id, tenantId: t } })) as any; }
  updateBankAccount(t: string, id: string, patch: Partial<BankAccount>) { return this.tx(t, (px) => px.bankAccount.update({ where: { id }, data: norm(patch) })) as any; }
  listBankAccountsByPerson(t: string, personId: string) { return this.tx(t, (px) => px.bankAccount.findMany({ where: { tenantId: t, personId } })) as any; }
  createSensitiveId(r: SensitiveIdentifier) { return this.tx(r.tenantId, (px) => px.sensitiveIdentifier.create({ data: norm(r) })); }
  getSensitiveId(t: string, id: string) { return this.tx(t, (px) => px.sensitiveIdentifier.findFirst({ where: { id, tenantId: t } })) as any; }
  listSensitiveIdsByPerson(t: string, personId: string) { return this.tx(t, (px) => px.sensitiveIdentifier.findMany({ where: { tenantId: t, personId } })) as any; }
  async appendAudit(e: AuditLog) { await this.tx(e.tenantId ?? "", (px) => px.auditLog.create({ data: norm(e) })); }
  listAuditByTenant(t: string) { return this.tx(t, (px) => px.auditLog.findMany({ where: { tenantId: t }, orderBy: { at: "desc" }, take: 200 })) as any; }
  createChangeRequest(r: ChangeRequest) { return this.tx(r.tenantId, (px) => px.changeRequest.create({ data: norm(r) })); }
  getChangeRequest(t: string, id: string) { return this.tx(t, (px) => px.changeRequest.findFirst({ where: { id, tenantId: t } })) as any; }
  updateChangeRequest(t: string, id: string, patch: Partial<ChangeRequest>) { return this.tx(t, (px) => px.changeRequest.update({ where: { id }, data: norm(patch) })) as any; }
  listChangeRequestsByPerson(t: string, personId: string) { return this.tx(t, (px) => px.changeRequest.findMany({ where: { tenantId: t, personId } })) as any; }
  listChangeRequestsByTenant(t: string) { return this.tx(t, (px) => px.changeRequest.findMany({ where: { tenantId: t } })) as any; }
}
