// Services métier D1 (company) + D2 (hr). Dépendent du port Repository (ADR-014),
// jamais d'une base concrète. Logique déterministe, événements publiés.
import { uid } from "./store.js";
import { EventBus } from "./events.js";
import { Repository } from "./repository.js";
import { assertCan } from "./auth.js";
import { minimumForCoef } from "./domain/convention.js";
import { obligationsForHeadcount, crossedThresholds } from "./domain/thresholds.js";
import { buildPayrollInput, Period } from "./domain/payroll-prep.js";
import { Ctx, AppError, ContractType, WorkingTimeUnit, Employment } from "./types.js";

const dLte = (a: string, b: string) => new Date(a).getTime() <= new Date(b).getTime();
const dayBefore = (iso: string) => { const d = new Date(iso); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);
const isActiveAt = (e: Employment, asOf: string) =>
  e.status !== "ENDED" && dLte(e.startDate, asOf) && (!e.endDate || dLte(asOf, e.endDate));

export class Services {
  constructor(private repo: Repository, private bus: EventBus) {}

  // ----------------------------- D1 -----------------------------
  async createLegalEntity(ctx: Ctx, input: { legalName: string; siren: string; tradeName?: string; legalForm?: string; groupId?: string }) {
    assertCan(ctx, "company.write");
    if (!/^[0-9]{9}$/.test(input.siren ?? "")) throw new AppError(400, "bad_request", "siren invalide (9 chiffres attendus)");
    if (await this.repo.sirenExists(ctx.tenantId, input.siren)) throw new AppError(400, "duplicate", "SIREN déjà présent dans ce tenant");
    const le = { id: uid(), tenantId: ctx.tenantId, status: "ACTIVE", ...input };
    await this.repo.createLegalEntity(le);
    this.bus.publish(ctx.tenantId, "LegalEntity", le.id, "CompanyCreated", { legalName: le.legalName, siren: le.siren }, ctx.userId);
    return le;
  }

  async getLegalEntity(ctx: Ctx, id: string) {
    const le = await this.repo.getLegalEntity(ctx.tenantId, id);
    if (!le) throw new AppError(404, "not_found", "Entité juridique introuvable");
    return le;
  }

  async createEstablishment(ctx: Ctx, companyId: string, input: { siret: string; name: string; addressLine?: string; postalCode?: string; city?: string; idcc?: string }) {
    assertCan(ctx, "establishment.write");
    await this.getLegalEntity(ctx, companyId);
    if (!/^[0-9]{14}$/.test(input.siret ?? "")) throw new AppError(400, "bad_request", "siret invalide (14 chiffres attendus)");
    if (await this.repo.siretExists(ctx.tenantId, input.siret)) throw new AppError(400, "duplicate", "SIRET déjà présent dans ce tenant");
    const est = { id: uid(), tenantId: ctx.tenantId, legalEntityId: companyId, status: "ACTIVE" as const, ...input };
    await this.repo.createEstablishment(est);
    this.bus.publish(ctx.tenantId, "Establishment", est.id, "EstablishmentCreated", { siret: est.siret, name: est.name }, ctx.userId);
    return est;
  }

  async createOperatingSite(ctx: Ctx, establishmentId: string, name: string) {
    assertCan(ctx, "organization.write");
    if (!(await this.repo.getEstablishment(ctx.tenantId, establishmentId))) throw new AppError(404, "not_found", "Établissement introuvable");
    const s = { id: uid(), tenantId: ctx.tenantId, establishmentId, name };
    await this.repo.createOperatingSite(s);
    this.bus.publish(ctx.tenantId, "OperatingSite", s.id, "OperatingSiteCreated", { name }, ctx.userId);
    return s;
  }

  async createPosition(ctx: Ctx, companyId: string, input: { title: string; classification?: string; coefficient?: number }) {
    assertCan(ctx, "organization.write");
    await this.getLegalEntity(ctx, companyId);
    const p = { id: uid(), tenantId: ctx.tenantId, legalEntityId: companyId, ...input };
    await this.repo.createPosition(p);
    this.bus.publish(ctx.tenantId, "Position", p.id, "PositionCreated", { title: p.title, classification: p.classification, coefficient: p.coefficient }, ctx.userId);
    return p;
  }

  async listLegalEntities(ctx: Ctx, opts: { page?: number; pageSize?: number } = {}) {
    assertCan(ctx, "company.read");
    const all = await this.repo.listLegalEntities(ctx.tenantId);
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 25));
    const start = (page - 1) * pageSize;
    return { items: all.slice(start, start + pageSize), page, pageSize, total: all.length };
  }

  async listEstablishments(ctx: Ctx, companyId: string) {
    assertCan(ctx, "establishment.read");
    await this.getLegalEntity(ctx, companyId);
    return this.repo.listEstablishmentsByCompany(ctx.tenantId, companyId);
  }

  /// Fermeture d'établissement : statut CLOSED + historique conservé (jamais de
  /// suppression). Successeur optionnel (repris dans l'événement). Idempotent.
  async closeEstablishment(ctx: Ctx, establishmentId: string, input: { closureDate: string; reason?: string; successorEstablishmentId?: string }) {
    assertCan(ctx, "establishment.close");
    const est = await this.repo.getEstablishment(ctx.tenantId, establishmentId);
    if (!est) throw new AppError(404, "not_found", "Établissement introuvable");
    if (input.successorEstablishmentId && !(await this.repo.getEstablishment(ctx.tenantId, input.successorEstablishmentId))) {
      throw new AppError(400, "bad_request", "Établissement successeur introuvable");
    }
    if (est.status === "CLOSED") return est; // idempotent : déjà fermé
    const updated = await this.repo.updateEstablishment(ctx.tenantId, est.id, { status: "CLOSED", closureDate: input.closureDate, validTo: input.closureDate });
    this.bus.publish(ctx.tenantId, "Establishment", est.id, "EstablishmentClosed", { closureDate: input.closureDate, reason: input.reason, successor: input.successorEstablishmentId ?? null }, ctx.userId);
    return updated;
  }

  /// Rattachement d'une convention/accord DATÉ (Agreement). L'établissement porte
  /// l'IDCC (résolution de la grille) ; l'Agreement historise le rattachement.
  async linkAgreement(ctx: Ctx, companyId: string, input: { type?: string; idcc?: string; title: string; source?: string; version?: string; effectiveFrom: string; effectiveTo?: string }) {
    assertCan(ctx, "organization.write");
    await this.getLegalEntity(ctx, companyId);
    if (!input.effectiveFrom) throw new AppError(400, "bad_request", "effectiveFrom requis (convention datée)");
    const ag = { id: uid(), tenantId: ctx.tenantId, legalEntityId: companyId, type: (input.type as any) ?? "COLLECTIVE", idcc: input.idcc, title: input.title, source: input.source, version: input.version, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo };
    await this.repo.createAgreement(ag);
    this.bus.publish(ctx.tenantId, "Agreement", ag.id, "AgreementLinked", { type: ag.type, idcc: ag.idcc, effectiveFrom: ag.effectiveFrom }, ctx.userId);
    return ag;
  }

  async listAgreements(ctx: Ctx, companyId: string) {
    assertCan(ctx, "company.read");
    await this.getLegalEntity(ctx, companyId);
    return this.repo.listAgreementsByCompany(ctx.tenantId, companyId);
  }

  /// Cycle de vie d'une obligation (DETECTED→QUALIFIED→ACTIVE→IN_PROGRESS→
  /// COMPLETED→ARCHIVED ; branches NOT_APPLICABLE / OVERDUE). Jamais de suppression.
  async advanceObligation(ctx: Ctx, obligationId: string, to: string) {
    assertCan(ctx, "obligation.manage");
    const ob = await this.repo.getObligation(ctx.tenantId, obligationId);
    if (!ob) throw new AppError(404, "not_found", "Obligation introuvable");
    const TRANSITIONS: Record<string, string[]> = {
      DETECTED: ["QUALIFIED", "NOT_APPLICABLE"],
      QUALIFIED: ["ACTIVE", "NOT_APPLICABLE"],
      ACTIVE: ["IN_PROGRESS", "OVERDUE", "NOT_APPLICABLE"],
      IN_PROGRESS: ["COMPLETED", "OVERDUE"],
      OVERDUE: ["IN_PROGRESS", "COMPLETED"],
      COMPLETED: ["ARCHIVED"],
      NOT_APPLICABLE: ["ARCHIVED"],
      ARCHIVED: [],
    };
    if (!(TRANSITIONS[ob.status] ?? []).includes(to)) {
      throw new AppError(409, "conflict", `Transition d'obligation invalide : ${ob.status} → ${to}`);
    }
    const updated = await this.repo.updateObligation(ctx.tenantId, ob.id, { status: to as any });
    this.bus.publish(ctx.tenantId, "Obligation", ob.id, "ObligationStatusChanged", { from: ob.status, to }, ctx.userId);
    return updated;
  }

  /// Registre Unique du Personnel — PROJECTION dynamique (jamais de base parallèle).
  /// Reflète l'entrée (startDate), l'évolution (contrat courant, classification via
  /// avenants appliqués) et la sortie (endDate + statut). Un RUP par établissement
  /// (filtre establishmentId) ou consolidé (entité juridique).
  async getRegistry(ctx: Ctx, companyId: string, opts: { establishmentId?: string } = {}) {
    assertCan(ctx, "registry.export");
    await this.getLegalEntity(ctx, companyId);
    let emps = await this.repo.listEmploymentsByCompany(ctx.tenantId, companyId);
    if (opts.establishmentId) emps = emps.filter((e) => e.administrativeEstablishmentId === opts.establishmentId);
    // Ordre chronologique d'entrée (comme un registre légal).
    emps = emps.sort((a, b) => a.startDate.localeCompare(b.startDate));
    const rows = [];
    for (const e of emps) {
      const person = await this.repo.getPerson(ctx.tenantId, e.personId);
      const est = e.administrativeEstablishmentId ? await this.repo.getEstablishment(ctx.tenantId, e.administrativeEstablishmentId) : undefined;
      const contracts = await this.repo.listContractsByEmployment(ctx.tenantId, e.id);
      const contract = contracts.sort((a, b) => a.startDate.localeCompare(b.startDate)).pop(); // contrat courant (post-avenants)
      rows.push({
        lastName: person?.lastName, firstName: person?.firstName,
        establishmentName: est?.name, establishmentSiret: est?.siret,
        contractType: contract?.type, classification: contract?.classification,
        startDate: e.startDate, endDate: e.endDate, status: e.status,
      });
    }
    return rows;
  }

  // ----------------------------- D2 -----------------------------
  async createPerson(ctx: Ctx, input: { lastName: string; firstName: string; birthDate?: string; usageName?: string; personalEmail?: string }) {
    assertCan(ctx, "person.write");
    const candidates = await this.repo.findPersonDuplicates(ctx.tenantId, input.lastName, input.firstName, input.birthDate);
    if (candidates.length) throw new AppError(409, "duplicate_candidate", "Correspondance potentielle détectée. Vérification nécessaire.", { candidates });
    const person = { id: uid(), tenantId: ctx.tenantId, ...input };
    await this.repo.createPerson(person);
    this.bus.publish(ctx.tenantId, "Person", person.id, "PersonCreated", { lastName: person.lastName, firstName: person.firstName }, ctx.userId);
    return person;
  }

  async hire(ctx: Ctx, cmd: {
    personId?: string; person?: { lastName: string; firstName: string; birthDate?: string };
    legalEntityId: string; administrativeEstablishmentId?: string; operatingSiteId?: string;
    positionId?: string; managerEmploymentId?: string; startDate: string; endDate?: string; contractType: ContractType;
    workingTime?: number; workingTimeUnit?: WorkingTimeUnit; grossMonthly?: number;
  }) {
    assertCan(ctx, "employment.write");
    await this.getLegalEntity(ctx, cmd.legalEntityId);

    let personId = cmd.personId;
    if (personId) {
      if (!(await this.repo.getPerson(ctx.tenantId, personId))) throw new AppError(404, "not_found", "Person introuvable");
    } else if (cmd.person) {
      const p = { id: uid(), tenantId: ctx.tenantId, ...cmd.person };
      await this.repo.createPerson(p);
      this.bus.publish(ctx.tenantId, "Person", p.id, "PersonCreated", { lastName: p.lastName, firstName: p.firstName }, ctx.userId);
      personId = p.id;
    } else {
      throw new AppError(400, "bad_request", "personId ou person requis");
    }

    const emp = { id: uid(), tenantId: ctx.tenantId, personId: personId!, legalEntityId: cmd.legalEntityId, administrativeEstablishmentId: cmd.administrativeEstablishmentId, startDate: cmd.startDate, status: "PRE_HIRE" as const };
    await this.repo.createEmployment(emp);

    // Convention collective DATÉE : classification/minimum selon idcc + coefficient à la date d'embauche.
    let convention: { idcc: string; coefficient: number; minimumMensuel?: number } | undefined;
    if (cmd.positionId) {
      const pos = await this.repo.getPosition(ctx.tenantId, cmd.positionId);
      const est = cmd.administrativeEstablishmentId ? await this.repo.getEstablishment(ctx.tenantId, cmd.administrativeEstablishmentId) : undefined;
      if (est?.idcc && pos?.coefficient != null) {
        const minimumMensuel = minimumForCoef(est.idcc, pos.coefficient, cmd.startDate);
        if (cmd.grossMonthly != null && minimumMensuel != null && cmd.grossMonthly < minimumMensuel) {
          throw new AppError(409, "below_convention_minimum", `Rémunération (${cmd.grossMonthly} €) sous le minimum conventionnel (${minimumMensuel} €) pour le coef ${pos.coefficient}`);
        }
        convention = { idcc: est.idcc, coefficient: pos.coefficient, minimumMensuel };
      }
    }

    const contract = { id: uid(), tenantId: ctx.tenantId, employmentId: emp.id, type: cmd.contractType, startDate: cmd.startDate, endDate: cmd.endDate, workingTime: cmd.workingTime, workingTimeUnit: cmd.workingTimeUnit ?? "HOURS_PER_WEEK", coefficient: convention?.coefficient, classification: convention ? `Coef ${convention.coefficient}` : undefined, grossMonthly: cmd.grossMonthly, status: "DRAFT" as const };
    await this.repo.createContract(contract);

    const assignment = { id: uid(), tenantId: ctx.tenantId, employmentId: emp.id, operatingSiteId: cmd.operatingSiteId, positionId: cmd.positionId, managerEmploymentId: cmd.managerEmploymentId, allocationPct: 100, validFrom: cmd.startDate };
    await this.repo.createAssignment(assignment);

    this.bus.publish(ctx.tenantId, "Employment", emp.id, "EmployeeHired", { personId, legalEntityId: cmd.legalEntityId, startDate: cmd.startDate, contractType: cmd.contractType }, ctx.userId);
    this.bus.publish(ctx.tenantId, "Contract", contract.id, "ContractCreated", { employmentId: emp.id, type: contract.type }, ctx.userId);
    this.bus.publish(ctx.tenantId, "Assignment", assignment.id, "EmployeeAssigned", { operatingSiteId: cmd.operatingSiteId, validFrom: cmd.startDate }, ctx.userId);
    await this.repo.appendHrEvent({ id: uid(), tenantId: ctx.tenantId, employmentId: emp.id, personId, type: "EMPLOYEE_HIRED", occurredAt: new Date().toISOString(), effectiveDate: cmd.startDate });

    // Effectif → seuils → obligations (proactif). Détection de franchissement.
    const emps = await this.repo.listEmploymentsByCompany(ctx.tenantId, cmd.legalEntityId);
    const headcount = emps.filter((e) => isActiveAt(e, today())).length;
    // Effectif historisé (SCD-2) : snapshot calculé, jamais saisi.
    await this.repo.createWorkforceSnapshot({ id: uid(), tenantId: ctx.tenantId, legalEntityId: cmd.legalEntityId, asOfDate: today(), headcount, method: "HEADCOUNT_ACTIVE" });
    for (const th of crossedThresholds(headcount - 1, headcount)) {
      this.bus.publish(ctx.tenantId, "LegalEntity", cmd.legalEntityId, "WorkforceThresholdCrossed", { threshold: th, headcount }, ctx.userId);
    }
    await this._refreshObligations(ctx, cmd.legalEntityId, headcount);

    return { employment: emp, contract, assignment, convention };
  }

  /// Interne : crée les obligations nouvellement applicables (idempotent) + événements.
  private async _refreshObligations(ctx: Ctx, companyId: string, headcount: number) {
    const applicable = obligationsForHeadcount(headcount);
    const existing = new Set((await this.repo.listObligations(ctx.tenantId, companyId)).map((o) => o.code));
    for (const o of applicable) {
      if (existing.has(o.code)) continue;
      const ob = { id: uid(), tenantId: ctx.tenantId, legalEntityId: companyId, code: o.code, title: o.title, source: o.source, triggerDescription: `Effectif ≥ ${o.threshold}`, status: "DETECTED" as const };
      await this.repo.createObligation(ob);
      this.bus.publish(ctx.tenantId, "Obligation", ob.id, "ObligationTriggered", { code: ob.code, source: ob.source }, ctx.userId);
    }
  }

  async computeWorkforce(ctx: Ctx, companyId: string, asOf?: string) {
    assertCan(ctx, "company.read");
    await this.getLegalEntity(ctx, companyId);
    const at = asOf ?? today();
    const emps = await this.repo.listEmploymentsByCompany(ctx.tenantId, companyId);
    const active = emps.filter((e) => isActiveAt(e, at));
    return { asOf: at, headcount: active.length, applicableObligations: obligationsForHeadcount(active.length) };
  }

  async listObligations(ctx: Ctx, companyId: string) {
    assertCan(ctx, "company.read");
    await this.getLegalEntity(ctx, companyId);
    return this.repo.listObligations(ctx.tenantId, companyId);
  }

  /// Simulation (sandbox, aucune écriture) : « et si j'embauche N personnes ? »
  async simulateWorkforce(ctx: Ctx, companyId: string, additionalHires: number) {
    assertCan(ctx, "company.read");
    await this.getLegalEntity(ctx, companyId);
    const emps = await this.repo.listEmploymentsByCompany(ctx.tenantId, companyId);
    const current = emps.filter((e) => isActiveAt(e, today())).length;
    const projected = current + Math.max(0, additionalHires);
    const currentCodes = new Set(obligationsForHeadcount(current).map((o) => o.code));
    const newObligations = obligationsForHeadcount(projected).filter((o) => !currentCodes.has(o.code));
    return { current, projected, crossedThresholds: crossedThresholds(current, projected), newObligations };
  }

  /// Création d'un contrat autonome (hors cascade d'embauche). Permission
  /// contract.create — distincte de validate et de sign (séparation stricte).
  async createContractForEmployment(ctx: Ctx, employmentId: string, input: { type: ContractType; startDate: string; endDate?: string; workingTime?: number; workingTimeUnit?: WorkingTimeUnit; classification?: string; coefficient?: number; grossMonthly?: number }) {
    assertCan(ctx, "contract.create");
    if (!(await this.repo.getEmployment(ctx.tenantId, employmentId))) throw new AppError(404, "not_found", "Employment introuvable");
    const contract = { id: uid(), tenantId: ctx.tenantId, employmentId, type: input.type, startDate: input.startDate, endDate: input.endDate, workingTime: input.workingTime, workingTimeUnit: input.workingTimeUnit ?? "HOURS_PER_WEEK", classification: input.classification, coefficient: input.coefficient, grossMonthly: input.grossMonthly, status: "DRAFT" as const };
    await this.repo.createContract(contract);
    this.bus.publish(ctx.tenantId, "Contract", contract.id, "ContractCreated", { employmentId, type: contract.type }, ctx.userId);
    return contract;
  }

  /// Validation d'un contrat (contract.validate ≠ create ≠ sign). DRAFT/REVIEW → VALIDATED.
  async validateContract(ctx: Ctx, contractId: string) {
    assertCan(ctx, "contract.validate");
    const c = await this.repo.getContract(ctx.tenantId, contractId);
    if (!c) throw new AppError(404, "not_found", "Contrat introuvable");
    if (!["DRAFT", "REVIEW"].includes(c.status)) throw new AppError(409, "conflict", `Contrat non validable (statut ${c.status})`);
    const updated = await this.repo.updateContract(ctx.tenantId, c.id, { status: "VALIDATED" });
    this.bus.publish(ctx.tenantId, "Contract", c.id, "ContractValidated", {}, ctx.userId);
    return updated;
  }

  async signContract(ctx: Ctx, contractId: string) {
    assertCan(ctx, "contract.sign");
    const c = await this.repo.getContract(ctx.tenantId, contractId);
    if (!c) throw new AppError(404, "not_found", "Contrat introuvable");
    if (!["DRAFT", "REVIEW", "VALIDATED"].includes(c.status)) throw new AppError(409, "conflict", `Contrat non signable (statut ${c.status})`);
    await this.repo.updateContract(ctx.tenantId, c.id, { status: "SIGNED" });
    this.bus.publish(ctx.tenantId, "Contract", c.id, "ContractSigned", { signedAt: new Date().toISOString() }, ctx.userId);
    const updated = await this.repo.updateContract(ctx.tenantId, c.id, { status: "ACTIVE" });
    this.bus.publish(ctx.tenantId, "Contract", c.id, "ContractActivated", {}, ctx.userId);
    await this.repo.updateEmployment(ctx.tenantId, c.employmentId, { status: "ACTIVE" });
    return updated;
  }

  // ------------------------------ Avenants -------------------------------
  async createAmendment(ctx: Ctx, contractId: string, input: { subject: string; effectiveDate: string; changes: any }) {
    assertCan(ctx, "amendment.create");
    const c = await this.repo.getContract(ctx.tenantId, contractId);
    if (!c) throw new AppError(404, "not_found", "Contrat introuvable");
    const am = { id: uid(), tenantId: ctx.tenantId, contractId, subject: input.subject, effectiveDate: input.effectiveDate, changes: input.changes ?? {}, status: "DRAFT" as const };
    await this.repo.createAmendment(am);
    this.bus.publish(ctx.tenantId, "ContractAmendment", am.id, "AmendmentCreated", { subject: am.subject, effectiveDate: am.effectiveDate }, ctx.userId);
    return am;
  }

  async signAmendment(ctx: Ctx, amendmentId: string) {
    assertCan(ctx, "amendment.sign"); // signer ≠ créer
    const am = await this.repo.getAmendment(ctx.tenantId, amendmentId);
    if (!am) throw new AppError(404, "not_found", "Avenant introuvable");
    if (!["DRAFT", "VALIDATED"].includes(am.status)) throw new AppError(409, "conflict", `Avenant non signable (statut ${am.status})`);
    await this.repo.updateAmendment(ctx.tenantId, am.id, { status: "SIGNED", signedAt: new Date().toISOString() });
    this.bus.publish(ctx.tenantId, "ContractAmendment", am.id, "AmendmentSigned", {}, ctx.userId);
    // Application des modifications au contrat (champs autorisés) — l'avenant reste l'historique.
    const allowed = ["grossMonthly", "workingTime", "workingTimeUnit", "classification", "coefficient"];
    const patch: any = {};
    for (const k of allowed) if (am.changes && am.changes[k] !== undefined) patch[k] = am.changes[k];
    if (Object.keys(patch).length) await this.repo.updateContract(ctx.tenantId, am.contractId, patch);
    const applied = await this.repo.updateAmendment(ctx.tenantId, am.id, { status: "APPLIED" });
    this.bus.publish(ctx.tenantId, "ContractAmendment", am.id, "AmendmentApplied", { applied: patch }, ctx.userId);
    return applied;
  }

  async listAmendments(ctx: Ctx, contractId: string) {
    assertCan(ctx, "employee360.read");
    return this.repo.listAmendmentsByContract(ctx.tenantId, contractId);
  }

  async addAssignment(ctx: Ctx, employmentId: string, input: { operatingSiteId?: string; orgUnitId?: string; positionId?: string; validFrom: string }) {
    assertCan(ctx, "assignment.write");
    if (!(await this.repo.getEmployment(ctx.tenantId, employmentId))) throw new AppError(404, "not_found", "Employment introuvable");
    const current = (await this.repo.listAssignmentsByEmployment(ctx.tenantId, employmentId))
      .filter((a) => !a.validTo).sort((a, b) => a.validFrom.localeCompare(b.validFrom)).pop();
    if (current) await this.repo.updateAssignment(ctx.tenantId, current.id, { validTo: dayBefore(input.validFrom) });
    const a = { id: uid(), tenantId: ctx.tenantId, employmentId, allocationPct: 100, ...input };
    await this.repo.createAssignment(a);
    this.bus.publish(ctx.tenantId, "Assignment", a.id, "EmployeeAssigned", { validFrom: input.validFrom }, ctx.userId);
    this.bus.publish(ctx.tenantId, "Assignment", a.id, "EmployeeMobility", { previous: current?.id ?? null, effectiveDate: input.validFrom }, ctx.userId);
    return a;
  }

  async declareDeparture(ctx: Ctx, employmentId: string, endDate: string, reason: string) {
    assertCan(ctx, "employment.departure");
    const emp = await this.repo.getEmployment(ctx.tenantId, employmentId);
    if (!emp) throw new AppError(404, "not_found", "Employment introuvable");
    if (["ENDED", "ARCHIVED"].includes(emp.status)) throw new AppError(409, "conflict", "Sortie déjà déclarée");
    // EXITING (sortie future) → ENDED à la date d'effet.
    const status = dLte(endDate, today()) ? "ENDED" : "EXITING";
    const updated = await this.repo.updateEmployment(ctx.tenantId, emp.id, { endDate, status });
    // Clôture des affectations encore ouvertes à la date d'effet (jamais d'écrasement :
    // on pose validTo). L'historique reste consultable.
    for (const a of await this.repo.listAssignmentsByEmployment(ctx.tenantId, employmentId)) {
      if (!a.validTo || !dLte(a.validTo, endDate)) await this.repo.updateAssignment(ctx.tenantId, a.id, { validTo: endDate });
    }
    // Désactivation des accès : portée par l'événement (consommé par le domaine Accès/IAM).
    this.bus.publish(ctx.tenantId, "Employment", emp.id, "EmployeeDeparture", { endDate, reason, accessRevoked: true }, ctx.userId);
    await this.repo.appendHrEvent({ id: uid(), tenantId: ctx.tenantId, employmentId, type: "DEPARTURE", occurredAt: new Date().toISOString(), effectiveDate: endDate });
    return updated;
  }

  /// Archivage post-rétention : ENDED → ARCHIVED (jamais de suppression).
  async archiveEmployment(ctx: Ctx, employmentId: string) {
    assertCan(ctx, "employment.departure");
    const emp = await this.repo.getEmployment(ctx.tenantId, employmentId);
    if (!emp) throw new AppError(404, "not_found", "Employment introuvable");
    if (emp.status !== "ENDED") throw new AppError(409, "conflict", `Archivable uniquement depuis ENDED (statut ${emp.status})`);
    const updated = await this.repo.updateEmployment(ctx.tenantId, emp.id, { status: "ARCHIVED" });
    this.bus.publish(ctx.tenantId, "Employment", emp.id, "EmploymentArchived", {}, ctx.userId);
    return updated;
  }

  // ------------------------- D4 — Préparation paie -------------------------
  async preparePayrollInput(ctx: Ctx, employmentId: string, period: Period) {
    assertCan(ctx, "payroll.prepare");
    const emp = await this.repo.getEmployment(ctx.tenantId, employmentId);
    if (!emp) throw new AppError(404, "not_found", "Employment introuvable");
    const contracts = await this.repo.listContractsByEmployment(ctx.tenantId, employmentId);
    const contract = contracts.sort((a, b) => a.startDate.localeCompare(b.startDate)).pop();
    const approvedLeaves = await this.repo.listApprovedLeavesByEmployment(ctx.tenantId, employmentId);
    const { sumHoursInMonth } = await import("./domain/time.js");
    const plannedHours = sumHoursInMonth(await this.repo.listShiftsByEmployment(ctx.tenantId, employmentId), period.year, period.month);
    const workedHours = sumHoursInMonth(await this.repo.listTimeEntriesByEmployment(ctx.tenantId, employmentId), period.year, period.month);
    const input = buildPayrollInput({ employmentId, employmentStart: emp.startDate, contract, approvedLeaves, plannedHours, workedHours, period });
    this.bus.publish(ctx.tenantId, "Employment", employmentId, "PayrollVariablesPrepared", { period: input.period }, ctx.userId);
    return input;
  }

  async preparePayrollBatch(ctx: Ctx, companyId: string, period: Period) {
    assertCan(ctx, "payroll.prepare");
    await this.getLegalEntity(ctx, companyId);
    const { end } = { end: `${period.year}-${String(period.month).padStart(2, "0")}-28` };
    const emps = await this.repo.listEmploymentsByCompany(ctx.tenantId, companyId);
    const active = emps.filter((e) => isActiveAt(e, end));
    const items = [];
    for (const e of active) items.push(await this.preparePayrollInput(ctx, e.id, period));
    return { period: `${period.year}-${String(period.month).padStart(2, "0")}`, count: items.length, items };
  }

  async employee360(ctx: Ctx, employmentId: string, asOf?: string) {
    assertCan(ctx, "employee360.read");
    const emp = await this.repo.getEmployment(ctx.tenantId, employmentId);
    if (!emp) throw new AppError(404, "not_found", "Employment introuvable");
    const at = asOf ?? today();
    const person = await this.repo.getPerson(ctx.tenantId, emp.personId);
    // Projection à la date `at` (Temporal Query) : affectation ET contrat en
    // vigueur à cette date. Jamais une base parallèle — reconstruit depuis les données.
    const assignment = (await this.repo.listAssignmentsByEmployment(ctx.tenantId, employmentId))
      .find((a) => dLte(a.validFrom, at) && (!a.validTo || dLte(at, a.validTo)));
    const contracts = await this.repo.listContractsByEmployment(ctx.tenantId, employmentId);
    const contractAt = contracts
      .filter((c) => dLte(c.startDate, at) && (!c.endDate || dLte(at, c.endDate)))
      .sort((a, b) => a.startDate.localeCompare(b.startDate)).pop();
    // À défaut de contrat en vigueur à la date (ex. asOf futur avant prise d'effet),
    // on retombe sur le plus récent connu pour rester informatif.
    const currentContract = contractAt ?? contracts.sort((a, b) => a.startDate.localeCompare(b.startDate)).pop();
    const timeline = (await this.repo.listHrEventsByEmployment(ctx.tenantId, employmentId))
      .filter((e) => !e.effectiveDate || dLte(e.effectiveDate, at));
    return { person, employment: emp, currentContract, currentAssignment: assignment, timeline, asOf: asOf ?? null };
  }
}
