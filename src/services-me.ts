// Espace collaborateur (self-service). Tout est résolu depuis le token
// (ctx.personId) : un collaborateur n'accède JAMAIS qu'à ses propres données.
// Données sensibles (bancaire, identifiants) exclues de cet espace.
import { Repository } from "./repository.js";
import { MvpServices } from "./services-mvp.js";
import { Ctx, AppError, Employment } from "./types.js";

export class MeService {
  constructor(private repo: Repository, private mvp: MvpServices) {}

  async resolve(ctx: Ctx): Promise<Employment> {
    if (!ctx.personId) throw new AppError(403, "forbidden", "Espace réservé aux collaborateurs.");
    const emp = await this.repo.findActiveEmploymentByPerson(ctx.tenantId, ctx.personId);
    if (!emp) throw new AppError(404, "not_found", "Aucun contrat rattaché à ce compte.");
    return emp;
  }

  async me(ctx: Ctx) {
    const emp = await this.resolve(ctx);
    const person = await this.repo.getPerson(ctx.tenantId, emp.personId);
    const contracts = await this.repo.listContractsByEmployment(ctx.tenantId, emp.id);
    const contract = contracts.sort((a, b) => a.startDate.localeCompare(b.startDate)).pop();
    const assignments = await this.repo.listAssignmentsByEmployment(ctx.tenantId, emp.id);
    const today = new Date().toISOString().slice(0, 10);
    const cur = assignments.find((a) => a.validFrom <= today && (!a.validTo || today <= a.validTo)) ?? assignments[assignments.length - 1];
    const position = cur?.positionId ? (await this.repo.getPosition(ctx.tenantId, cur.positionId))?.title : undefined;
    const docs = await this.repo.listDocumentsByPerson(ctx.tenantId, emp.personId);
    const shifts = await this.repo.listShiftsByEmployment(ctx.tenantId, emp.id);
    const leaves = await this.repo.listLeaveRequestsByEmployment(ctx.tenantId, emp.id);

    const steps = [
      { key: "profile", label: "Compléter mon profil", done: !!person?.personalEmail },
      { key: "contract", label: "Mon contrat est signé", done: contract?.status === "ACTIVE" },
      { key: "documents", label: "Mes documents sont disponibles", done: docs.length > 0 },
      { key: "planning", label: "Consulter mon planning", done: shifts.length > 0 },
    ];
    const done = steps.filter((s) => s.done).length;

    return {
      greetingName: person?.firstName ?? "",
      person: { firstName: person?.firstName, lastName: person?.lastName },
      employment: { startDate: emp.startDate, status: emp.status },
      contract: contract ? { type: contract.type, status: contract.status, grossMonthly: contract.grossMonthly, workingTime: contract.workingTime } : null,
      position,
      onboarding: { percent: Math.round((done / steps.length) * 100), steps },
      counts: { documents: docs.length, pendingLeaves: leaves.filter((l) => l.status === "REQUESTED").length },
    };
  }

  async myDocuments(ctx: Ctx) {
    const emp = await this.resolve(ctx);
    const docs = await this.repo.listDocumentsByPerson(ctx.tenantId, emp.personId);
    return docs.map((d: any) => ({ id: d.id, type: d.type, label: d.label, signatureStatus: d.signatureStatus, retentionUntil: d.retentionUntil }));
  }

  async myLeaves(ctx: Ctx, asOf?: string) {
    const emp = await this.resolve(ctx);
    const leaves = await this.repo.listLeaveRequestsByEmployment(ctx.tenantId, emp.id);
    // Mes soldes par type décompté (CP, RTT) — à la date asOf si fournie.
    const balancesArr = await Promise.all((["PAID", "RTT"] as const).map((t) => this.mvp.leaveBalance(ctx, emp.id, t, asOf)));
    const balances = Object.fromEntries(balancesArr.map((b) => [b.type, b]));
    return {
      balance: balances.PAID, // compat : solde CP
      balances,
      leaves: leaves.map((l) => ({ id: l.id, type: l.type, startDate: l.startDate, endDate: l.endDate, days: l.days, status: l.status })),
    };
  }

  async myPlanning(ctx: Ctx) {
    const emp = await this.resolve(ctx);
    const shifts = await this.repo.listShiftsByEmployment(ctx.tenantId, emp.id);
    return shifts.map((s) => ({ date: s.date, startTime: s.startTime, endTime: s.endTime, hours: s.hours }));
  }
}
