// D8 — Dialogue social / IRP (CSE) : mandats des élus + réunions (ordre du jour, PV).
import { uid } from "./store.js";
import { EventBus } from "./events.js";
import { Repository } from "./repository.js";
import { assertCan } from "./auth.js";
import { Ctx, AppError, CseRole, MeetingType, NegotiationTheme, NegotiationStatus } from "./types.js";

export class SocialService {
  constructor(private repo: Repository, private bus: EventBus) {}

  async addMandate(ctx: Ctx, companyId: string, input: { employmentId: string; role: CseRole; college?: string; startDate: string }) {
    assertCan(ctx, "social.write");
    if (!(await this.repo.getLegalEntity(ctx.tenantId, companyId))) throw new AppError(404, "not_found", "Entité juridique introuvable");
    if (!(await this.repo.getEmployment(ctx.tenantId, input.employmentId))) throw new AppError(404, "not_found", "Collaborateur introuvable");
    const m = { id: uid(), tenantId: ctx.tenantId, legalEntityId: companyId, employmentId: input.employmentId, role: input.role, college: input.college, startDate: input.startDate, status: "ACTIVE" as const };
    await this.repo.createMandate(m);
    this.bus.publish(ctx.tenantId, "CseMandate", m.id, "CseMandateCreated", { role: m.role }, ctx.userId);
    return m;
  }

  async listMandates(ctx: Ctx, companyId: string) {
    assertCan(ctx, "social.read");
    const mandates = await this.repo.listMandatesByCompany(ctx.tenantId, companyId);
    // Enrichit avec le nom du collaborateur
    const out = [];
    for (const m of mandates) {
      const emp = await this.repo.getEmployment(ctx.tenantId, m.employmentId);
      const person = emp ? await this.repo.getPerson(ctx.tenantId, emp.personId) : undefined;
      out.push({ ...m, name: person ? `${person.firstName} ${person.lastName}` : m.employmentId });
    }
    return out;
  }

  async planMeeting(ctx: Ctx, companyId: string, input: { date: string; type?: MeetingType; agenda?: string[] }) {
    assertCan(ctx, "social.write");
    if (!(await this.repo.getLegalEntity(ctx.tenantId, companyId))) throw new AppError(404, "not_found", "Entité juridique introuvable");
    const mtg = { id: uid(), tenantId: ctx.tenantId, legalEntityId: companyId, date: input.date, type: input.type ?? "ORDINAIRE", agenda: input.agenda ?? [], status: "PLANNED" as const };
    await this.repo.createMeeting(mtg);
    this.bus.publish(ctx.tenantId, "CseMeeting", mtg.id, "CseMeetingPlanned", { date: mtg.date, type: mtg.type }, ctx.userId);
    return mtg;
  }

  async listMeetings(ctx: Ctx, companyId: string) {
    assertCan(ctx, "social.read");
    return this.repo.listMeetingsByCompany(ctx.tenantId, companyId);
  }

  async openNegotiation(ctx: Ctx, companyId: string, input: { year: number; theme: NegotiationTheme; startDate?: string }) {
    assertCan(ctx, "social.write");
    if (!(await this.repo.getLegalEntity(ctx.tenantId, companyId))) throw new AppError(404, "not_found", "Entité juridique introuvable");
    const n = { id: uid(), tenantId: ctx.tenantId, legalEntityId: companyId, year: input.year, theme: input.theme, status: "PLANNED" as const, startDate: input.startDate };
    await this.repo.createNegotiation(n);
    this.bus.publish(ctx.tenantId, "Negotiation", n.id, "NegotiationOpened", { year: n.year, theme: n.theme }, ctx.userId);
    return n;
  }

  async listNegotiations(ctx: Ctx, companyId: string) {
    assertCan(ctx, "social.read");
    return this.repo.listNegotiationsByCompany(ctx.tenantId, companyId);
  }

  async setNegotiationStatus(ctx: Ctx, id: string, status: NegotiationStatus, notes?: string) {
    assertCan(ctx, "social.write");
    const n = await this.repo.getNegotiation(ctx.tenantId, id);
    if (!n) throw new AppError(404, "not_found", "Négociation introuvable");
    const updated = await this.repo.updateNegotiation(ctx.tenantId, id, { status, notes: notes ?? n.notes });
    const type = status === "AGREEMENT" ? "NegotiationAgreement" : status === "DISAGREEMENT" ? "NegotiationDisagreement" : "NegotiationUpdated";
    this.bus.publish(ctx.tenantId, "Negotiation", id, type, { status }, ctx.userId);
    return updated;
  }

  async recordMinutes(ctx: Ctx, meetingId: string, minutes: string) {
    assertCan(ctx, "social.write");
    const mtg = await this.repo.getMeeting(ctx.tenantId, meetingId);
    if (!mtg) throw new AppError(404, "not_found", "Réunion introuvable");
    const updated = await this.repo.updateMeeting(ctx.tenantId, meetingId, { status: "HELD", minutes });
    this.bus.publish(ctx.tenantId, "CseMeeting", meetingId, "CseMeetingHeld", { hasMinutes: !!minutes }, ctx.userId);
    return updated;
  }
}
