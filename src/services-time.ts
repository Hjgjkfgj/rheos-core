// D3 — Planning & pointage : shifts prévus, pointage réel, synthèse d'écart.
import { uid } from "./store.js";
import { EventBus } from "./events.js";
import { Repository } from "./repository.js";
import { assertCan } from "./auth.js";
import { hoursBetween, sumHoursInMonth } from "./domain/time.js";
import { Ctx, AppError } from "./types.js";

export class TimeService {
  constructor(private repo: Repository, private bus: EventBus) {}

  async planShift(ctx: Ctx, employmentId: string, input: { date: string; startTime: string; endTime: string; operatingSiteId?: string }) {
    assertCan(ctx, "planning.write");
    if (!(await this.repo.getEmployment(ctx.tenantId, employmentId))) throw new AppError(404, "not_found", "Employment introuvable");
    const hours = hoursBetween(input.startTime, input.endTime);
    if (hours <= 0) throw new AppError(400, "bad_request", "Plage horaire invalide");
    const shift = { id: uid(), tenantId: ctx.tenantId, employmentId, ...input, hours };
    await this.repo.createShift(shift);
    this.bus.publish(ctx.tenantId, "Shift", shift.id, "ShiftPlanned", { date: input.date, hours }, ctx.userId);
    return shift;
  }

  async recordTime(ctx: Ctx, employmentId: string, input: { date: string; clockIn: string; clockOut: string }) {
    assertCan(ctx, "time.record");
    if (!(await this.repo.getEmployment(ctx.tenantId, employmentId))) throw new AppError(404, "not_found", "Employment introuvable");
    const hours = hoursBetween(input.clockIn, input.clockOut);
    if (hours <= 0) throw new AppError(400, "bad_request", "Pointage invalide");
    const entry = { id: uid(), tenantId: ctx.tenantId, employmentId, ...input, hours };
    await this.repo.createTimeEntry(entry);
    this.bus.publish(ctx.tenantId, "TimeEntry", entry.id, "TimeRecorded", { date: input.date, hours }, ctx.userId);
    return entry;
  }

  async timeSummary(ctx: Ctx, employmentId: string, year: number, month: number) {
    assertCan(ctx, "planning.read");
    if (!(await this.repo.getEmployment(ctx.tenantId, employmentId))) throw new AppError(404, "not_found", "Employment introuvable");
    const shifts = await this.repo.listShiftsByEmployment(ctx.tenantId, employmentId);
    const entries = await this.repo.listTimeEntriesByEmployment(ctx.tenantId, employmentId);
    const plannedHours = sumHoursInMonth(shifts, year, month);
    const workedHours = sumHoursInMonth(entries, year, month);
    return { period: `${year}-${String(month).padStart(2, "0")}`, plannedHours, workedHours, variance: Math.round((workedHours - plannedHours) * 100) / 100 };
  }
}
