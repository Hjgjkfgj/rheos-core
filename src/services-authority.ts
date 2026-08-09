// D9 — Institutions & Pouvoirs publics : suivi des interactions avec les
// autorités (Inspection du travail, URSSAF, CARSAT…). Une échéance de réponse
// alimente automatiquement la veille (Deadline) quand une date limite est fixée.
import { uid } from "./store.js";
import { EventBus } from "./events.js";
import { Repository } from "./repository.js";
import { assertCan } from "./auth.js";
import { Ctx, AppError, Authority, InteractionType } from "./types.js";

export class AuthorityService {
  constructor(private repo: Repository, private bus: EventBus) {}

  async createInteraction(ctx: Ctx, companyId: string, input: { authority: Authority; type: InteractionType; reference?: string; date: string; dueDate?: string; notes?: string }) {
    assertCan(ctx, "authority.write");
    if (!(await this.repo.getLegalEntity(ctx.tenantId, companyId))) throw new AppError(404, "not_found", "Entité juridique introuvable");
    const i = { id: uid(), tenantId: ctx.tenantId, legalEntityId: companyId, authority: input.authority, type: input.type, reference: input.reference, date: input.date, dueDate: input.dueDate, notes: input.notes, status: "OPEN" as const };
    await this.repo.createInteraction(i);
    this.bus.publish(ctx.tenantId, "AuthorityInteraction", i.id, "AuthorityInteractionCreated", { authority: i.authority, type: i.type }, ctx.userId);
    // Échéance de réponse → veille
    if (input.dueDate) {
      await this.repo.createDeadline({ id: uid(), tenantId: ctx.tenantId, legalEntityId: companyId, type: "AUTHORITY", label: `Réponse ${input.authority} (${input.type})`, dueDate: input.dueDate, status: "OPEN" });
    }
    return i;
  }

  async listInteractions(ctx: Ctx, companyId: string) {
    assertCan(ctx, "authority.read");
    return this.repo.listInteractionsByCompany(ctx.tenantId, companyId);
  }

  async respond(ctx: Ctx, id: string, notes?: string) {
    assertCan(ctx, "authority.write");
    const i = await this.repo.getInteraction(ctx.tenantId, id);
    if (!i) throw new AppError(404, "not_found", "Interaction introuvable");
    const updated = await this.repo.updateInteraction(ctx.tenantId, id, { status: "RESPONDED", responseDate: new Date().toISOString().slice(0, 10), notes: notes ?? i.notes });
    this.bus.publish(ctx.tenantId, "AuthorityInteraction", id, "AuthorityInteractionResponded", {}, ctx.userId);
    return updated;
  }

  async close(ctx: Ctx, id: string) {
    assertCan(ctx, "authority.write");
    const i = await this.repo.getInteraction(ctx.tenantId, id);
    if (!i) throw new AppError(404, "not_found", "Interaction introuvable");
    const updated = await this.repo.updateInteraction(ctx.tenantId, id, { status: "CLOSED" });
    this.bus.publish(ctx.tenantId, "AuthorityInteraction", id, "AuthorityInteractionClosed", {}, ctx.userId);
    return updated;
  }
}
