// D7 — Carrière, Compétences & Formation. Les expirations d'habilitations et les
// échéances de formation obligatoire alimentent la veille (Deadline).
import { uid } from "./store.js";
import { EventBus } from "./events.js";
import { Repository } from "./repository.js";
import { assertCan } from "./auth.js";
import { Ctx, AppError, CompetencyLevel, TrainingType, ReviewType } from "./types.js";

export class CareerService {
  constructor(private repo: Repository, private bus: EventBus) {}

  private async company(ctx: Ctx, employmentId: string) {
    const emp = await this.repo.getEmployment(ctx.tenantId, employmentId);
    if (!emp) throw new AppError(404, "not_found", "Collaborateur introuvable");
    return emp;
  }

  async addCompetency(ctx: Ctx, employmentId: string, input: { name: string; level: CompetencyLevel; acquiredDate?: string; expiresAt?: string }) {
    assertCan(ctx, "talent.write");
    const emp = await this.company(ctx, employmentId);
    const c = { id: uid(), tenantId: ctx.tenantId, employmentId, name: input.name, level: input.level, acquiredDate: input.acquiredDate, expiresAt: input.expiresAt };
    await this.repo.createCompetency(c);
    this.bus.publish(ctx.tenantId, "Competency", c.id, "CompetencyAdded", { name: c.name, level: c.level }, ctx.userId);
    if (input.expiresAt) {
      await this.repo.createDeadline({ id: uid(), tenantId: ctx.tenantId, legalEntityId: emp.legalEntityId, employmentId, type: "HABILITATION", label: `Habilitation « ${input.name} » à renouveler`, dueDate: input.expiresAt, status: "OPEN" });
    }
    return c;
  }

  async listCompetencies(ctx: Ctx, employmentId: string) {
    assertCan(ctx, "talent.read");
    return this.repo.listCompetenciesByEmployment(ctx.tenantId, employmentId);
  }

  async planTraining(ctx: Ctx, employmentId: string, input: { title: string; type?: TrainingType; dueDate?: string; provider?: string }) {
    assertCan(ctx, "talent.write");
    const emp = await this.company(ctx, employmentId);
    const tr = { id: uid(), tenantId: ctx.tenantId, legalEntityId: emp.legalEntityId, employmentId, title: input.title, type: input.type ?? "SKILL", status: "PLANNED" as const, dueDate: input.dueDate, provider: input.provider };
    await this.repo.createTraining(tr);
    this.bus.publish(ctx.tenantId, "Training", tr.id, "TrainingPlanned", { title: tr.title, type: tr.type }, ctx.userId);
    if (input.dueDate) {
      await this.repo.createDeadline({ id: uid(), tenantId: ctx.tenantId, legalEntityId: emp.legalEntityId, employmentId, type: "TRAINING", label: `Formation « ${input.title} » à réaliser`, dueDate: input.dueDate, status: "OPEN" });
    }
    return tr;
  }

  async completeTraining(ctx: Ctx, id: string, date?: string) {
    assertCan(ctx, "talent.write");
    const tr = await this.repo.getTraining(ctx.tenantId, id);
    if (!tr) throw new AppError(404, "not_found", "Formation introuvable");
    const updated = await this.repo.updateTraining(ctx.tenantId, id, { status: "DONE", date: date ?? new Date().toISOString().slice(0, 10) });
    this.bus.publish(ctx.tenantId, "Training", id, "TrainingCompleted", {}, ctx.userId);
    return updated;
  }

  async listTrainings(ctx: Ctx, companyId: string) {
    assertCan(ctx, "talent.read");
    return this.repo.listTrainingsByCompany(ctx.tenantId, companyId);
  }

  async planReview(ctx: Ctx, employmentId: string, input: { type: ReviewType; date: string }) {
    assertCan(ctx, "talent.write");
    await this.company(ctx, employmentId);
    const rv = { id: uid(), tenantId: ctx.tenantId, employmentId, type: input.type, date: input.date, status: "PLANNED" as const };
    await this.repo.createReview(rv);
    this.bus.publish(ctx.tenantId, "CareerReview", rv.id, "ReviewPlanned", { type: rv.type }, ctx.userId);
    return rv;
  }

  async holdReview(ctx: Ctx, id: string, notes?: string) {
    assertCan(ctx, "talent.write");
    const rv = await this.repo.getReview(ctx.tenantId, id);
    if (!rv) throw new AppError(404, "not_found", "Entretien introuvable");
    return this.repo.updateReview(ctx.tenantId, id, { status: "HELD", notes });
  }

  async listReviews(ctx: Ctx, employmentId: string) {
    assertCan(ctx, "talent.read");
    return this.repo.listReviewsByEmployment(ctx.tenantId, employmentId);
  }
}
