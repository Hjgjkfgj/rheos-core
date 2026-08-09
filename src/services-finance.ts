// D5 — Pilotage économique & financier. NE possède pas de données propres : il
// CONSOMME les contrats/effectif (ADR : le pilotage agrège, il ne duplique pas).
// Taux de charges patronales indicatif (paramétrable) ; le calcul de paie exact
// reste délégué au moteur certifié (ADR-008).
import { uid } from "./store.js";
import { EventBus } from "./events.js";
import { Repository } from "./repository.js";
import { assertCan } from "./auth.js";
import { Ctx, AppError } from "./types.js";

const CHARGES_RATE = Number(process.env.CHARGES_RATE ?? 0.42); // indicatif
const round2 = (n: number) => Math.round(n * 100) / 100;

export class FinanceService {
  constructor(private repo: Repository, private bus: EventBus) {}

  async setBudget(ctx: Ctx, companyId: string, input: { year: number; amount: number }) {
    assertCan(ctx, "finance.write");
    if (!(await this.repo.getLegalEntity(ctx.tenantId, companyId))) throw new AppError(404, "not_found", "Entité juridique introuvable");
    const prev = await this.repo.getBudgetByYear(ctx.tenantId, companyId, input.year);
    const b = { id: uid(), tenantId: ctx.tenantId, legalEntityId: companyId, year: input.year, amount: input.amount, version: (prev?.version ?? 0) + 1 };
    await this.repo.createBudget(b);
    this.bus.publish(ctx.tenantId, "Budget", b.id, "BudgetSet", { year: b.year, amount: b.amount, version: b.version }, ctx.userId);
    return b;
  }

  /// Masse salariale et coût employeur estimés à partir des contrats actifs.
  private async payrollMass(ctx: Ctx, companyId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const emps = (await this.repo.listEmploymentsByCompany(ctx.tenantId, companyId))
      .filter((e) => e.status !== "ENDED" && e.startDate <= today && (!e.endDate || e.endDate >= today));
    let monthlyGross = 0, etp = 0;
    for (const e of emps) {
      const contracts = await this.repo.listContractsByEmployment(ctx.tenantId, e.id);
      const c = contracts.sort((a, b) => a.startDate.localeCompare(b.startDate)).pop();
      if (c?.grossMonthly) monthlyGross += Number(c.grossMonthly);
      etp += c?.workingTimeUnit === "HOURS_PER_WEEK" && c?.workingTime ? Number(c.workingTime) / 35 : 1;
    }
    return { headcount: emps.length, etp: round2(etp), monthlyGross: round2(monthlyGross) };
  }

  async pilotage(ctx: Ctx, companyId: string, year?: number) {
    assertCan(ctx, "finance.read");
    if (!(await this.repo.getLegalEntity(ctx.tenantId, companyId))) throw new AppError(404, "not_found", "Entité juridique introuvable");
    const y = year ?? new Date().getFullYear();
    const m = await this.payrollMass(ctx, companyId);
    const annualGross = round2(m.monthlyGross * 12);
    const employerCostMonthly = round2(m.monthlyGross * (1 + CHARGES_RATE));
    const employerCostAnnual = round2(annualGross * (1 + CHARGES_RATE));
    const budget = await this.repo.getBudgetByYear(ctx.tenantId, companyId, y);
    const budgetAmount = budget ? Number(budget.amount) : null;
    const variance = budgetAmount != null ? round2(employerCostAnnual - budgetAmount) : null;
    const variancePct = budgetAmount ? round2((variance! / budgetAmount) * 100) : null;
    return {
      year: y, chargesRate: CHARGES_RATE, indicative: true,
      headcount: m.headcount, etp: m.etp,
      masseSalarialeBruteMensuelle: m.monthlyGross, masseSalarialeBruteAnnuelle: annualGross,
      coutEmployeurMensuel: employerCostMonthly, coutEmployeurAnnuel: employerCostAnnual,
      landingEstime: employerCostAnnual,
      budget: budgetAmount, ecart: variance, ecartPct: variancePct,
    };
  }

  /// Simulation de coût : impact annuel de N embauches à un brut moyen.
  async costSimulate(ctx: Ctx, companyId: string, input: { additionalHires: number; avgGross: number }) {
    assertCan(ctx, "finance.read");
    const base = await this.pilotage(ctx, companyId);
    const addAnnualGross = round2((Number(input.additionalHires) || 0) * (Number(input.avgGross) || 0) * 12);
    const addEmployerCost = round2(addAnnualGross * (1 + CHARGES_RATE));
    return {
      current: base.coutEmployeurAnnuel,
      addedEmployerCostAnnual: addEmployerCost,
      projectedEmployerCostAnnual: round2(base.coutEmployeurAnnuel + addEmployerCost),
      budget: base.budget,
      projectedVariance: base.budget != null ? round2(base.coutEmployeurAnnuel + addEmployerCost - base.budget) : null,
    };
  }
}
