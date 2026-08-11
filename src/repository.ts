// Port de persistance (ADR-014). Les services dépendent de cette interface,
// jamais d'une base concrète. Deux implémentations : MemoryRepository (tests,
// dev) et PrismaRepository (production, PostgreSQL + RLS).
import {
  LegalEntity, Establishment, OperatingSite, Position, Person, Employment,
  Contract, Assignment, Doc, HrEvent, DomainEvent, LeaveRequest, LeaveType, Obligation,
  Shift, TimeEntry, ContractAmendment, Deadline, CseMandate, CseMeeting, AuthorityInteraction,
  Risk, WorkAccident, Competency, Training, CareerReview, Budget, Negotiation,
  Agreement, WorkforceSnapshot, LeaveLedgerEntry, AiAuditLog,
  Address, BankAccount, SensitiveIdentifier, AuditLog, ChangeRequest,
} from "./types.js";

export interface Repository {
  // D1
  sirenExists(tenantId: string, siren: string): Promise<boolean>;
  createLegalEntity(r: LegalEntity): Promise<LegalEntity>;
  getLegalEntity(tenantId: string, id: string): Promise<LegalEntity | undefined>;
  listLegalEntities(tenantId: string): Promise<LegalEntity[]>;
  siretExists(tenantId: string, siret: string): Promise<boolean>;
  createEstablishment(r: Establishment): Promise<Establishment>;
  getEstablishment(tenantId: string, id: string): Promise<Establishment | undefined>;
  updateEstablishment(tenantId: string, id: string, patch: Partial<Establishment>): Promise<Establishment | undefined>;
  listEstablishmentsByCompany(tenantId: string, companyId: string): Promise<Establishment[]>;
  createOperatingSite(r: OperatingSite): Promise<OperatingSite>;
  createPosition(r: Position): Promise<Position>;
  getPosition(tenantId: string, id: string): Promise<Position | undefined>;
  // D1 — Convention rattachée + effectif historisé
  createAgreement(r: Agreement): Promise<Agreement>;
  listAgreementsByCompany(tenantId: string, companyId: string): Promise<Agreement[]>;
  createWorkforceSnapshot(r: WorkforceSnapshot): Promise<WorkforceSnapshot>;
  listWorkforceSnapshotsByCompany(tenantId: string, companyId: string): Promise<WorkforceSnapshot[]>;
  // D2
  createPerson(r: Person): Promise<Person>;
  getPerson(tenantId: string, id: string): Promise<Person | undefined>;
  findPersonDuplicates(tenantId: string, lastName: string, firstName: string, birthDate?: string): Promise<Person[]>;
  createEmployment(r: Employment): Promise<Employment>;
  getEmployment(tenantId: string, id: string): Promise<Employment | undefined>;
  findActiveEmploymentByPerson(tenantId: string, personId: string): Promise<Employment | undefined>;
  updateEmployment(tenantId: string, id: string, patch: Partial<Employment>): Promise<Employment | undefined>;
  listEmploymentsByCompany(tenantId: string, companyId: string): Promise<Employment[]>;
  createContract(r: Contract): Promise<Contract>;
  getContract(tenantId: string, id: string): Promise<Contract | undefined>;
  updateContract(tenantId: string, id: string, patch: Partial<Contract>): Promise<Contract | undefined>;
  listContractsByEmployment(tenantId: string, employmentId: string): Promise<Contract[]>;
  createAmendment(r: ContractAmendment): Promise<ContractAmendment>;
  getAmendment(tenantId: string, id: string): Promise<ContractAmendment | undefined>;
  updateAmendment(tenantId: string, id: string, patch: Partial<ContractAmendment>): Promise<ContractAmendment | undefined>;
  listAmendmentsByContract(tenantId: string, contractId: string): Promise<ContractAmendment[]>;
  createAssignment(r: Assignment): Promise<Assignment>;
  updateAssignment(tenantId: string, id: string, patch: Partial<Assignment>): Promise<Assignment | undefined>;
  listAssignmentsByEmployment(tenantId: string, employmentId: string): Promise<Assignment[]>;
  appendHrEvent(r: HrEvent): Promise<HrEvent>;
  listHrEventsByEmployment(tenantId: string, employmentId: string): Promise<HrEvent[]>;
  // D10
  createDocument(r: Doc): Promise<Doc>;
  getDocument(tenantId: string, id: string): Promise<Doc | undefined>;
  updateDocument(tenantId: string, id: string, patch: Partial<Doc>): Promise<Doc | undefined>;
  deleteDocument(tenantId: string, id: string): Promise<boolean>;
  listDocumentsByPerson(tenantId: string, personId: string): Promise<Doc[]>;
  // D3 — Planning & pointage
  createShift(r: Shift): Promise<Shift>;
  listShiftsByEmployment(tenantId: string, employmentId: string): Promise<Shift[]>;
  createTimeEntry(r: TimeEntry): Promise<TimeEntry>;
  listTimeEntriesByEmployment(tenantId: string, employmentId: string): Promise<TimeEntry[]>;
  // D3 — Congés
  createLeaveRequest(r: LeaveRequest): Promise<LeaveRequest>;
  getLeaveRequest(tenantId: string, id: string): Promise<LeaveRequest | undefined>;
  updateLeaveRequest(tenantId: string, id: string, patch: Partial<LeaveRequest>): Promise<LeaveRequest | undefined>;
  listApprovedLeaves(tenantId: string, employmentId: string, type: LeaveType): Promise<LeaveRequest[]>;
  listApprovedLeavesByEmployment(tenantId: string, employmentId: string): Promise<LeaveRequest[]>;
  listLeaveRequestsByEmployment(tenantId: string, employmentId: string): Promise<LeaveRequest[]>;
  // D3 — Grand livre des congés (append-only)
  createLeaveLedgerEntry(r: LeaveLedgerEntry): Promise<LeaveLedgerEntry>;
  listLeaveLedgerByEmployment(tenantId: string, employmentId: string): Promise<LeaveLedgerEntry[]>;
  // D1 — Obligations
  createObligation(r: Obligation): Promise<Obligation>;
  getObligation(tenantId: string, id: string): Promise<Obligation | undefined>;
  updateObligation(tenantId: string, id: string, patch: Partial<Obligation>): Promise<Obligation | undefined>;
  listObligations(tenantId: string, companyId: string): Promise<Obligation[]>;
  // D8 — CSE
  createMandate(r: CseMandate): Promise<CseMandate>;
  listMandatesByCompany(tenantId: string, companyId: string): Promise<CseMandate[]>;
  createMeeting(r: CseMeeting): Promise<CseMeeting>;
  getMeeting(tenantId: string, id: string): Promise<CseMeeting | undefined>;
  updateMeeting(tenantId: string, id: string, patch: Partial<CseMeeting>): Promise<CseMeeting | undefined>;
  listMeetingsByCompany(tenantId: string, companyId: string): Promise<CseMeeting[]>;
  createNegotiation(r: Negotiation): Promise<Negotiation>;
  getNegotiation(tenantId: string, id: string): Promise<Negotiation | undefined>;
  updateNegotiation(tenantId: string, id: string, patch: Partial<Negotiation>): Promise<Negotiation | undefined>;
  listNegotiationsByCompany(tenantId: string, companyId: string): Promise<Negotiation[]>;
  // D5 — Pilotage financier
  createBudget(r: Budget): Promise<Budget>;
  listBudgetsByCompany(tenantId: string, companyId: string): Promise<Budget[]>;
  getBudgetByYear(tenantId: string, companyId: string, year: number): Promise<Budget | undefined>;
  // D7 — Carrière & Formation
  createCompetency(r: Competency): Promise<Competency>;
  listCompetenciesByEmployment(tenantId: string, employmentId: string): Promise<Competency[]>;
  createTraining(r: Training): Promise<Training>;
  getTraining(tenantId: string, id: string): Promise<Training | undefined>;
  updateTraining(tenantId: string, id: string, patch: Partial<Training>): Promise<Training | undefined>;
  listTrainingsByCompany(tenantId: string, companyId: string): Promise<Training[]>;
  createReview(r: CareerReview): Promise<CareerReview>;
  getReview(tenantId: string, id: string): Promise<CareerReview | undefined>;
  updateReview(tenantId: string, id: string, patch: Partial<CareerReview>): Promise<CareerReview | undefined>;
  listReviewsByEmployment(tenantId: string, employmentId: string): Promise<CareerReview[]>;
  // D6 — Santé & Prévention
  createRisk(r: Risk): Promise<Risk>;
  getRisk(tenantId: string, id: string): Promise<Risk | undefined>;
  updateRisk(tenantId: string, id: string, patch: Partial<Risk>): Promise<Risk | undefined>;
  listRisksByCompany(tenantId: string, companyId: string): Promise<Risk[]>;
  createAccident(r: WorkAccident): Promise<WorkAccident>;
  listAccidentsByCompany(tenantId: string, companyId: string): Promise<WorkAccident[]>;
  // D9 — Autorités
  createInteraction(r: AuthorityInteraction): Promise<AuthorityInteraction>;
  getInteraction(tenantId: string, id: string): Promise<AuthorityInteraction | undefined>;
  updateInteraction(tenantId: string, id: string, patch: Partial<AuthorityInteraction>): Promise<AuthorityInteraction | undefined>;
  listInteractionsByCompany(tenantId: string, companyId: string): Promise<AuthorityInteraction[]>;
  // Veille & échéances
  createDeadline(r: Deadline): Promise<Deadline>;
  listDeadlinesByCompany(tenantId: string, companyId: string): Promise<Deadline[]>;
  listDeadlinesByTenant(tenantId: string): Promise<Deadline[]>;
  updateDeadline(tenantId: string, id: string, patch: Partial<Deadline>): Promise<Deadline | undefined>;
  // Scans tenant-wide (centre de notifications)
  listContractsByTenant(tenantId: string): Promise<Contract[]>;
  listLeaveRequestsByTenant(tenantId: string): Promise<LeaveRequest[]>;
  listDocumentsByTenant(tenantId: string): Promise<Doc[]>;
  listObligationsByTenant(tenantId: string): Promise<Obligation[]>;
  listEmploymentsByTenant(tenantId: string): Promise<Employment[]>;
  listPersonsByTenant(tenantId: string): Promise<Person[]>;
  // Événements
  appendDomainEvent(e: DomainEvent): Promise<void>;
  listDomainEventsByTenant(tenantId: string): Promise<DomainEvent[]>;
  // Supervision : liveness de la base (SELECT 1). Memory → toujours vrai.
  ping(): Promise<boolean>;
  // Journal IA (append-only)
  appendAiAudit(e: AiAuditLog): Promise<void>;
  listAiAuditByTenant(tenantId: string): Promise<AiAuditLog[]>;
  // D2b — Coordonnées historisées (SCD-2), identifiants sensibles, audit, change requests
  createAddress(r: Address): Promise<Address>;
  getAddress(tenantId: string, id: string): Promise<Address | undefined>;
  updateAddress(tenantId: string, id: string, patch: Partial<Address>): Promise<Address | undefined>;
  listAddressesByPerson(tenantId: string, personId: string): Promise<Address[]>;
  createBankAccount(r: BankAccount): Promise<BankAccount>;
  getBankAccount(tenantId: string, id: string): Promise<BankAccount | undefined>;
  updateBankAccount(tenantId: string, id: string, patch: Partial<BankAccount>): Promise<BankAccount | undefined>;
  listBankAccountsByPerson(tenantId: string, personId: string): Promise<BankAccount[]>;
  createSensitiveId(r: SensitiveIdentifier): Promise<SensitiveIdentifier>;
  getSensitiveId(tenantId: string, id: string): Promise<SensitiveIdentifier | undefined>;
  listSensitiveIdsByPerson(tenantId: string, personId: string): Promise<SensitiveIdentifier[]>;
  appendAudit(e: AuditLog): Promise<void>;
  listAuditByTenant(tenantId: string): Promise<AuditLog[]>;
  createChangeRequest(r: ChangeRequest): Promise<ChangeRequest>;
  getChangeRequest(tenantId: string, id: string): Promise<ChangeRequest | undefined>;
  updateChangeRequest(tenantId: string, id: string, patch: Partial<ChangeRequest>): Promise<ChangeRequest | undefined>;
  listChangeRequestsByPerson(tenantId: string, personId: string): Promise<ChangeRequest[]>;
  listChangeRequestsByTenant(tenantId: string): Promise<ChangeRequest[]>;
}

// ---------------------------------------------------------------------------
// Implémentation en mémoire (scopée tenant, simule la RLS). Arrays publics
// pour l'inspection dans les tests.
// ---------------------------------------------------------------------------
export class MemoryRepository implements Repository {
  legalEntities: LegalEntity[] = [];
  establishments: Establishment[] = [];
  operatingSites: OperatingSite[] = [];
  positions: Position[] = [];
  persons: Person[] = [];
  employments: Employment[] = [];
  contracts: Contract[] = [];
  amendments: ContractAmendment[] = [];
  assignments: Assignment[] = [];
  documents: Doc[] = [];
  hrEvents: HrEvent[] = [];
  leaveRequests: LeaveRequest[] = [];
  shifts: Shift[] = [];
  timeEntries: TimeEntry[] = [];
  domainEvents: DomainEvent[] = [];
  obligations: Obligation[] = [];
  deadlines: Deadline[] = [];
  mandates: CseMandate[] = [];
  meetings: CseMeeting[] = [];
  negotiations: Negotiation[] = [];
  interactions: AuthorityInteraction[] = [];
  risks: Risk[] = [];
  accidents: WorkAccident[] = [];
  competencies: Competency[] = [];
  trainings: Training[] = [];
  reviews: CareerReview[] = [];
  budgets: Budget[] = [];
  agreements: Agreement[] = [];
  workforceSnapshots: WorkforceSnapshot[] = [];
  leaveLedger: LeaveLedgerEntry[] = [];
  aiAudit: AiAuditLog[] = [];
  addresses: Address[] = [];
  bankAccounts: BankAccount[] = [];
  sensitiveIds: SensitiveIdentifier[] = [];
  auditLog: AuditLog[] = [];
  changeRequests: ChangeRequest[] = [];

  private t<T extends { tenantId: string }>(a: T[], tenantId: string) { return a.filter((x) => x.tenantId === tenantId); }
  private id<T extends { id: string; tenantId: string }>(a: T[], tenantId: string, id: string) { return a.find((x) => x.id === id && x.tenantId === tenantId); }

  async sirenExists(t: string, siren: string) { return this.t(this.legalEntities, t).some((l) => l.siren === siren); }
  async createLegalEntity(r: LegalEntity) { this.legalEntities.push(r); return r; }
  async getLegalEntity(t: string, id: string) { return this.id(this.legalEntities, t, id); }
  async listLegalEntities(t: string) { return this.t(this.legalEntities, t); }
  async siretExists(t: string, siret: string) { return this.t(this.establishments, t).some((e) => e.siret === siret); }
  async createEstablishment(r: Establishment) { this.establishments.push(r); return r; }
  async getEstablishment(t: string, id: string) { return this.id(this.establishments, t, id); }
  async updateEstablishment(t: string, id: string, patch: Partial<Establishment>) { const e = this.id(this.establishments, t, id); if (e) Object.assign(e, patch); return e; }
  async listEstablishmentsByCompany(t: string, companyId: string) { return this.t(this.establishments, t).filter((e) => e.legalEntityId === companyId); }
  async createOperatingSite(r: OperatingSite) { this.operatingSites.push(r); return r; }
  async createPosition(r: Position) { this.positions.push(r); return r; }
  async getPosition(t: string, id: string) { return this.id(this.positions, t, id); }
  async createAgreement(r: Agreement) { this.agreements.push(r); return r; }
  async listAgreementsByCompany(t: string, companyId: string) { return this.t(this.agreements, t).filter((a) => a.legalEntityId === companyId); }
  async createWorkforceSnapshot(r: WorkforceSnapshot) { this.workforceSnapshots.push(r); return r; }
  async listWorkforceSnapshotsByCompany(t: string, companyId: string) { return this.t(this.workforceSnapshots, t).filter((w) => w.legalEntityId === companyId); }

  async createPerson(r: Person) { this.persons.push(r); return r; }
  async getPerson(t: string, id: string) { return this.id(this.persons, t, id); }
  async findPersonDuplicates(t: string, lastName: string, firstName: string, birthDate?: string) {
    return this.t(this.persons, t).filter((p) =>
      p.lastName.toLowerCase() === lastName.toLowerCase() &&
      p.firstName.toLowerCase() === firstName.toLowerCase() &&
      (!birthDate || p.birthDate === birthDate));
  }
  async listPersonsByTenant(t: string) { return this.t(this.persons, t); }
  async createEmployment(r: Employment) { this.employments.push(r); return r; }
  async getEmployment(t: string, id: string) { return this.id(this.employments, t, id); }
  async findActiveEmploymentByPerson(t: string, personId: string) { return this.t(this.employments, t).find((e) => e.personId === personId && e.status !== "ENDED") ?? this.t(this.employments, t).find((e) => e.personId === personId); }
  async updateEmployment(t: string, id: string, patch: Partial<Employment>) { const e = this.id(this.employments, t, id); if (e) Object.assign(e, patch); return e; }
  async listEmploymentsByCompany(t: string, companyId: string) { return this.t(this.employments, t).filter((e) => e.legalEntityId === companyId); }
  async createContract(r: Contract) { this.contracts.push(r); return r; }
  async getContract(t: string, id: string) { return this.id(this.contracts, t, id); }
  async updateContract(t: string, id: string, patch: Partial<Contract>) { const c = this.id(this.contracts, t, id); if (c) Object.assign(c, patch); return c; }
  async listContractsByEmployment(t: string, employmentId: string) { return this.t(this.contracts, t).filter((c) => c.employmentId === employmentId); }
  async createAmendment(r: ContractAmendment) { this.amendments.push(r); return r; }
  async getAmendment(t: string, id: string) { return this.id(this.amendments, t, id); }
  async updateAmendment(t: string, id: string, patch: Partial<ContractAmendment>) { const a = this.id(this.amendments, t, id); if (a) Object.assign(a, patch); return a; }
  async listAmendmentsByContract(t: string, contractId: string) { return this.t(this.amendments, t).filter((a) => a.contractId === contractId); }
  async createAssignment(r: Assignment) { this.assignments.push(r); return r; }
  async updateAssignment(t: string, id: string, patch: Partial<Assignment>) { const a = this.id(this.assignments, t, id); if (a) Object.assign(a, patch); return a; }
  async listAssignmentsByEmployment(t: string, employmentId: string) { return this.t(this.assignments, t).filter((a) => a.employmentId === employmentId); }
  async appendHrEvent(r: HrEvent) { this.hrEvents.push(r); return r; }
  async listHrEventsByEmployment(t: string, employmentId: string) { return this.t(this.hrEvents, t).filter((e) => e.employmentId === employmentId); }

  async createDocument(r: Doc) { this.documents.push(r); return r; }
  async getDocument(t: string, id: string) { return this.id(this.documents, t, id); }
  async updateDocument(t: string, id: string, patch: Partial<Doc>) { const d = this.id(this.documents, t, id); if (d) Object.assign(d, patch); return d; }
  async deleteDocument(t: string, id: string) { const i = this.documents.findIndex((d) => d.id === id && d.tenantId === t); if (i < 0) return false; this.documents.splice(i, 1); return true; }
  async listDocumentsByPerson(t: string, personId: string) { return this.t(this.documents, t).filter((d) => d.personId === personId); }

  async createShift(r: Shift) { this.shifts.push(r); return r; }
  async listShiftsByEmployment(t: string, employmentId: string) { return this.t(this.shifts, t).filter((s) => s.employmentId === employmentId); }
  async createTimeEntry(r: TimeEntry) { this.timeEntries.push(r); return r; }
  async listTimeEntriesByEmployment(t: string, employmentId: string) { return this.t(this.timeEntries, t).filter((e) => e.employmentId === employmentId); }
  async createLeaveRequest(r: LeaveRequest) { this.leaveRequests.push(r); return r; }
  async getLeaveRequest(t: string, id: string) { return this.id(this.leaveRequests, t, id); }
  async updateLeaveRequest(t: string, id: string, patch: Partial<LeaveRequest>) { const l = this.id(this.leaveRequests, t, id); if (l) Object.assign(l, patch); return l; }
  async listApprovedLeaves(t: string, employmentId: string, type: LeaveType) {
    return this.t(this.leaveRequests, t).filter((l) => l.employmentId === employmentId && l.type === type && l.status === "APPROVED");
  }
  async listApprovedLeavesByEmployment(t: string, employmentId: string) {
    return this.t(this.leaveRequests, t).filter((l) => l.employmentId === employmentId && l.status === "APPROVED");
  }
  async listLeaveRequestsByEmployment(t: string, employmentId: string) {
    return this.t(this.leaveRequests, t).filter((l) => l.employmentId === employmentId);
  }
  async createLeaveLedgerEntry(r: LeaveLedgerEntry) { this.leaveLedger.push(r); return r; }
  async listLeaveLedgerByEmployment(t: string, employmentId: string) { return this.t(this.leaveLedger, t).filter((e) => e.employmentId === employmentId); }

  async createObligation(r: Obligation) { this.obligations.push(r); return r; }
  async getObligation(t: string, id: string) { return this.id(this.obligations, t, id); }
  async updateObligation(t: string, id: string, patch: Partial<Obligation>) { const o = this.id(this.obligations, t, id); if (o) Object.assign(o, patch); return o; }
  async listObligations(t: string, companyId: string) { return this.t(this.obligations, t).filter((o) => o.legalEntityId === companyId); }
  async createMandate(r: CseMandate) { this.mandates.push(r); return r; }
  async listMandatesByCompany(t: string, companyId: string) { return this.t(this.mandates, t).filter((m) => m.legalEntityId === companyId); }
  async createMeeting(r: CseMeeting) { this.meetings.push(r); return r; }
  async getMeeting(t: string, id: string) { return this.id(this.meetings, t, id); }
  async updateMeeting(t: string, id: string, patch: Partial<CseMeeting>) { const m = this.id(this.meetings, t, id); if (m) Object.assign(m, patch); return m; }
  async listMeetingsByCompany(t: string, companyId: string) { return this.t(this.meetings, t).filter((m) => m.legalEntityId === companyId); }
  async createNegotiation(r: Negotiation) { this.negotiations.push(r); return r; }
  async getNegotiation(t: string, id: string) { return this.id(this.negotiations, t, id); }
  async updateNegotiation(t: string, id: string, patch: Partial<Negotiation>) { const n = this.id(this.negotiations, t, id); if (n) Object.assign(n, patch); return n; }
  async listNegotiationsByCompany(t: string, companyId: string) { return this.t(this.negotiations, t).filter((n) => n.legalEntityId === companyId); }
  async createBudget(r: Budget) { this.budgets.push(r); return r; }
  async listBudgetsByCompany(t: string, companyId: string) { return this.t(this.budgets, t).filter((b) => b.legalEntityId === companyId); }
  async getBudgetByYear(t: string, companyId: string, year: number) { return this.t(this.budgets, t).filter((b) => b.legalEntityId === companyId && b.year === year).sort((a, b) => a.version - b.version).pop(); }
  async createCompetency(r: Competency) { this.competencies.push(r); return r; }
  async listCompetenciesByEmployment(t: string, employmentId: string) { return this.t(this.competencies, t).filter((c) => c.employmentId === employmentId); }
  async createTraining(r: Training) { this.trainings.push(r); return r; }
  async getTraining(t: string, id: string) { return this.id(this.trainings, t, id); }
  async updateTraining(t: string, id: string, patch: Partial<Training>) { const x = this.id(this.trainings, t, id); if (x) Object.assign(x, patch); return x; }
  async listTrainingsByCompany(t: string, companyId: string) { return this.t(this.trainings, t).filter((x) => x.legalEntityId === companyId); }
  async createReview(r: CareerReview) { this.reviews.push(r); return r; }
  async getReview(t: string, id: string) { return this.id(this.reviews, t, id); }
  async updateReview(t: string, id: string, patch: Partial<CareerReview>) { const x = this.id(this.reviews, t, id); if (x) Object.assign(x, patch); return x; }
  async listReviewsByEmployment(t: string, employmentId: string) { return this.t(this.reviews, t).filter((x) => x.employmentId === employmentId); }
  async createRisk(r: Risk) { this.risks.push(r); return r; }
  async getRisk(t: string, id: string) { return this.id(this.risks, t, id); }
  async updateRisk(t: string, id: string, patch: Partial<Risk>) { const r = this.id(this.risks, t, id); if (r) Object.assign(r, patch); return r; }
  async listRisksByCompany(t: string, companyId: string) { return this.t(this.risks, t).filter((r) => r.legalEntityId === companyId); }
  async createAccident(r: WorkAccident) { this.accidents.push(r); return r; }
  async listAccidentsByCompany(t: string, companyId: string) { return this.t(this.accidents, t).filter((a) => a.legalEntityId === companyId); }
  async createInteraction(r: AuthorityInteraction) { this.interactions.push(r); return r; }
  async getInteraction(t: string, id: string) { return this.id(this.interactions, t, id); }
  async updateInteraction(t: string, id: string, patch: Partial<AuthorityInteraction>) { const i = this.id(this.interactions, t, id); if (i) Object.assign(i, patch); return i; }
  async listInteractionsByCompany(t: string, companyId: string) { return this.t(this.interactions, t).filter((i) => i.legalEntityId === companyId); }
  async createDeadline(r: Deadline) { this.deadlines.push(r); return r; }
  async listDeadlinesByCompany(t: string, companyId: string) { return this.t(this.deadlines, t).filter((d) => d.legalEntityId === companyId); }
  async listDeadlinesByTenant(t: string) { return this.t(this.deadlines, t); }
  async updateDeadline(t: string, id: string, patch: Partial<Deadline>) { const d = this.id(this.deadlines, t, id); if (d) Object.assign(d, patch); return d; }
  async listContractsByTenant(t: string) { return this.t(this.contracts, t); }
  async listLeaveRequestsByTenant(t: string) { return this.t(this.leaveRequests, t); }
  async listDocumentsByTenant(t: string) { return this.t(this.documents, t); }
  async listObligationsByTenant(t: string) { return this.t(this.obligations, t); }
  async listEmploymentsByTenant(t: string) { return this.t(this.employments, t); }

  async appendDomainEvent(e: DomainEvent) { this.domainEvents.push(e); }
  async listDomainEventsByTenant(t: string) { return this.t(this.domainEvents, t); }
  async ping() { return true; }
  async appendAiAudit(e: AiAuditLog) { this.aiAudit.push(e); }
  async listAiAuditByTenant(t: string) { return this.t(this.aiAudit, t); }

  async createAddress(r: Address) { this.addresses.push(r); return r; }
  async getAddress(t: string, id: string) { return this.id(this.addresses, t, id); }
  async updateAddress(t: string, id: string, patch: Partial<Address>) { const a = this.id(this.addresses, t, id); if (a) Object.assign(a, patch); return a; }
  async listAddressesByPerson(t: string, personId: string) { return this.t(this.addresses, t).filter((a) => a.personId === personId); }
  async createBankAccount(r: BankAccount) { this.bankAccounts.push(r); return r; }
  async getBankAccount(t: string, id: string) { return this.id(this.bankAccounts, t, id); }
  async updateBankAccount(t: string, id: string, patch: Partial<BankAccount>) { const b = this.id(this.bankAccounts, t, id); if (b) Object.assign(b, patch); return b; }
  async listBankAccountsByPerson(t: string, personId: string) { return this.t(this.bankAccounts, t).filter((b) => b.personId === personId); }
  async createSensitiveId(r: SensitiveIdentifier) { this.sensitiveIds.push(r); return r; }
  async getSensitiveId(t: string, id: string) { return this.id(this.sensitiveIds, t, id); }
  async listSensitiveIdsByPerson(t: string, personId: string) { return this.t(this.sensitiveIds, t).filter((s) => s.personId === personId); }
  async appendAudit(e: AuditLog) { this.auditLog.push(e); }
  async listAuditByTenant(t: string) { return this.auditLog.filter((a) => a.tenantId === t); }
  async createChangeRequest(r: ChangeRequest) { this.changeRequests.push(r); return r; }
  async getChangeRequest(t: string, id: string) { return this.id(this.changeRequests, t, id); }
  async updateChangeRequest(t: string, id: string, patch: Partial<ChangeRequest>) { const c = this.id(this.changeRequests, t, id); if (c) Object.assign(c, patch); return c; }
  async listChangeRequestsByPerson(t: string, personId: string) { return this.t(this.changeRequests, t).filter((c) => c.personId === personId); }
  async listChangeRequestsByTenant(t: string) { return this.t(this.changeRequests, t); }

  // --- Sauvegarde / restauration (Lot 8) ---------------------------------
  // Les collections métier sont les propriétés tableau de ce dépôt. dump() en
  // produit une copie sérialisable ; load() les restaure (restauration testée).
  private collections(): string[] {
    return Object.keys(this).filter((k) => Array.isArray((this as any)[k]));
  }
  dump(): Record<string, any[]> {
    const out: Record<string, any[]> = {};
    for (const k of this.collections()) out[k] = JSON.parse(JSON.stringify((this as any)[k]));
    return out;
  }
  load(snapshot: Record<string, any[]>): void {
    for (const k of this.collections()) (this as any)[k] = JSON.parse(JSON.stringify(snapshot[k] ?? []));
  }
}
