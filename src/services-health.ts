// D6 — Santé, Sécurité & Prévention. DUERP (registre des risques coté) + accidents.
// Ne stocke AUCUNE donnée médicale individuelle (secret médical / HDS — ADR-009) :
// uniquement des données de prévention/sécurité relevant de l'employeur.
import { uid } from "./store.js";
import { EventBus } from "./events.js";
import { Repository } from "./repository.js";
import { assertCan } from "./auth.js";
import { Ctx, AppError, RiskLevel, AccidentSeverity } from "./types.js";

function levelOf(score: number): RiskLevel { return score >= 9 ? "HIGH" : score >= 4 ? "MEDIUM" : "LOW"; }

export class HealthService {
  constructor(private repo: Repository, private bus: EventBus) {}

  async addRisk(ctx: Ctx, companyId: string, input: { unit?: string; hazard: string; gravity: number; probability: number; measures?: string }) {
    assertCan(ctx, "health.write");
    if (!(await this.repo.getLegalEntity(ctx.tenantId, companyId))) throw new AppError(404, "not_found", "Entité juridique introuvable");
    const g = Math.max(1, Math.min(4, Number(input.gravity) || 1));
    const p = Math.max(1, Math.min(4, Number(input.probability) || 1));
    const score = g * p;
    const risk = { id: uid(), tenantId: ctx.tenantId, legalEntityId: companyId, unit: input.unit, hazard: input.hazard, gravity: g, probability: p, score, level: levelOf(score), measures: input.measures, status: "OPEN" as const };
    await this.repo.createRisk(risk);
    this.bus.publish(ctx.tenantId, "Risk", risk.id, "RiskAssessed", { hazard: risk.hazard, level: risk.level }, ctx.userId);
    return risk;
  }

  async updateRisk(ctx: Ctx, id: string, patch: { actionPlan?: string; status?: "OPEN" | "CONTROLLED" }) {
    assertCan(ctx, "health.write");
    const r = await this.repo.getRisk(ctx.tenantId, id);
    if (!r) throw new AppError(404, "not_found", "Risque introuvable");
    return this.repo.updateRisk(ctx.tenantId, id, patch);
  }

  async listRisks(ctx: Ctx, companyId: string) {
    assertCan(ctx, "health.read");
    return this.repo.listRisksByCompany(ctx.tenantId, companyId);
  }

  /// Synthèse DUERP : répartition par niveau + risques prioritaires.
  async duerpSummary(ctx: Ctx, companyId: string) {
    assertCan(ctx, "health.read");
    const risks = await this.repo.listRisksByCompany(ctx.tenantId, companyId);
    const byLevel = { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<RiskLevel, number>;
    for (const r of risks) byLevel[r.level]++;
    const priorities = risks.filter((r) => r.status === "OPEN").sort((a, b) => b.score - a.score).slice(0, 5);
    return { total: risks.length, byLevel, priorities };
  }

  async declareAccident(ctx: Ctx, companyId: string, input: { employmentId?: string; date: string; description: string; severity: AccidentSeverity; lostDays?: number }) {
    assertCan(ctx, "health.write");
    if (!(await this.repo.getLegalEntity(ctx.tenantId, companyId))) throw new AppError(404, "not_found", "Entité juridique introuvable");
    const acc = { id: uid(), tenantId: ctx.tenantId, legalEntityId: companyId, employmentId: input.employmentId, date: input.date, description: input.description, severity: input.severity, lostDays: input.lostDays };
    await this.repo.createAccident(acc);
    this.bus.publish(ctx.tenantId, "WorkAccident", acc.id, "WorkAccidentDeclared", { severity: acc.severity }, ctx.userId);
    // Accident grave → échéance de déclaration (veille) sous 48h.
    if (input.severity === "SERIOUS") {
      const due = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      await this.repo.createDeadline({ id: uid(), tenantId: ctx.tenantId, legalEntityId: companyId, type: "ACCIDENT_DECLARATION", label: "Déclarer l'accident grave (CPAM / Inspection)", dueDate: due, status: "OPEN" });
    }
    return acc;
  }

  async listAccidents(ctx: Ctx, companyId: string) {
    assertCan(ctx, "health.read");
    return this.repo.listAccidentsByCompany(ctx.tenantId, companyId);
  }
}
