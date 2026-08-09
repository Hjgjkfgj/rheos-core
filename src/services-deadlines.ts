// Veille & échéances : agrège échéances dérivées (fins de CDD, sorties,
// deadlines d'obligations) et échéances personnalisées (visite médicale,
// habilitation…) en une vue à horizon, avec statut.
import { uid } from "./store.js";
import { EventBus } from "./events.js";
import { Repository } from "./repository.js";
import { assertCan } from "./auth.js";
import { statusOf, daysUntil } from "./domain/deadlines.js";
import { Ctx, AppError } from "./types.js";

export class DeadlineService {
  constructor(private repo: Repository, private bus: EventBus) {}

  async createDeadline(ctx: Ctx, employmentId: string, input: { type: string; label: string; dueDate: string }) {
    assertCan(ctx, "planning.write");
    const emp = await this.repo.getEmployment(ctx.tenantId, employmentId);
    if (!emp) throw new AppError(404, "not_found", "Employment introuvable");
    const d = { id: uid(), tenantId: ctx.tenantId, legalEntityId: emp.legalEntityId, employmentId, type: input.type, label: input.label, dueDate: input.dueDate, status: "OPEN" as const };
    await this.repo.createDeadline(d);
    this.bus.publish(ctx.tenantId, "Deadline", d.id, "DeadlineCreated", { type: d.type, dueDate: d.dueDate }, ctx.userId);
    return d;
  }

  async markDone(ctx: Ctx, id: string) {
    assertCan(ctx, "planning.write");
    const d = await this.repo.updateDeadline(ctx.tenantId, id, { status: "DONE" });
    if (!d) throw new AppError(404, "not_found", "Échéance introuvable");
    return d;
  }

  async forCompany(ctx: Ctx, companyId: string, soonDays = 60) {
    assertCan(ctx, "notifications.read");
    if (!(await this.repo.getLegalEntity(ctx.tenantId, companyId))) throw new AppError(404, "not_found", "Entité juridique introuvable");
    const items: any[] = [];

    // Échéances personnalisées ouvertes
    for (const d of await this.repo.listDeadlinesByCompany(ctx.tenantId, companyId)) {
      if (d.status === "OPEN") items.push({ source: "custom", type: d.type, label: d.label, dueDate: d.dueDate, employmentId: d.employmentId, id: d.id });
    }
    // Dérivées : fins de CDD, sorties
    const emps = await this.repo.listEmploymentsByCompany(ctx.tenantId, companyId);
    for (const e of emps) {
      const contracts = await this.repo.listContractsByEmployment(ctx.tenantId, e.id);
      for (const c of contracts) if (c.type === "CDD" && c.endDate) items.push({ source: "contract", type: "CDD_END", label: "Fin de CDD", dueDate: c.endDate, employmentId: e.id });
      if (e.endDate) items.push({ source: "employment", type: "EMPLOYMENT_END", label: "Fin de relation", dueDate: e.endDate, employmentId: e.id });
    }
    // Dérivées : deadlines d'obligations
    for (const o of await this.repo.listObligations(ctx.tenantId, companyId)) {
      if (o.deadline) items.push({ source: "obligation", type: "OBLIGATION", label: o.title, dueDate: o.deadline });
    }

    const enriched = items.map((i) => ({ ...i, daysUntil: daysUntil(i.dueDate), status: statusOf(i.dueDate, soonDays) }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const counts = { OVERDUE: 0, DUE_SOON: 0, UPCOMING: 0 } as Record<string, number>;
    for (const i of enriched) counts[i.status]++;
    return { companyId, soonDays, counts, items: enriched };
  }
}
