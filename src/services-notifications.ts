// Centre de notifications / alertes : agrège en une vue priorisée tout ce qui
// attend une action, à partir des données déjà produites par les domaines.
import { Repository } from "./repository.js";
import { assertCan } from "./auth.js";
import { statusOf } from "./domain/deadlines.js";
import { Ctx } from "./types.js";

export type Severity = "CRITICAL" | "IMPORTANT" | "ACTION" | "INFO";
const RANK: Record<Severity, number> = { CRITICAL: 0, IMPORTANT: 1, ACTION: 2, INFO: 3 };

export interface Notification {
  severity: Severity;
  category: string;
  title: string;
  ref: { type: string; id: string };
}

export class NotificationService {
  constructor(private repo: Repository) {}

  async build(ctx: Ctx): Promise<{ counts: Record<Severity, number>; items: Notification[] }> {
    assertCan(ctx, "notifications.read");
    const t = ctx.tenantId;
    const items: Notification[] = [];

    for (const o of await this.repo.listObligationsByTenant(t)) {
      if (o.status === "DETECTED" || o.status === "OVERDUE") {
        items.push({ severity: o.status === "OVERDUE" ? "CRITICAL" : "IMPORTANT", category: "obligation", title: `Obligation à traiter : ${o.title}`, ref: { type: "Obligation", id: o.id } });
      }
    }
    for (const c of await this.repo.listContractsByTenant(t)) {
      if (["DRAFT", "REVIEW", "VALIDATED"].includes(c.status)) {
        items.push({ severity: "ACTION", category: "contract", title: "Contrat en attente de signature", ref: { type: "Contract", id: c.id } });
      }
    }
    for (const d of await this.repo.listDocumentsByTenant(t)) {
      if (d.signatureStatus === "PENDING") {
        items.push({ severity: "ACTION", category: "document", title: `Document à signer : ${d.label}`, ref: { type: "Document", id: d.id } });
      }
    }
    for (const l of await this.repo.listLeaveRequestsByTenant(t)) {
      if (l.status === "REQUESTED") {
        items.push({ severity: "ACTION", category: "leave", title: `Demande de congé à valider (${l.days} j, ${l.type})`, ref: { type: "LeaveRequest", id: l.id } });
      }
    }
    for (const e of await this.repo.listEmploymentsByTenant(t)) {
      if (e.status === "EXITING") {
        items.push({ severity: "IMPORTANT", category: "departure", title: "Sortie à préparer", ref: { type: "Employment", id: e.id } });
      }
    }
    // Veille : échéances personnalisées ouvertes (visite médicale, habilitation…)
    for (const d of await this.repo.listDeadlinesByTenant(t)) {
      if (d.status !== "OPEN") continue;
      const st = statusOf(d.dueDate);
      if (st === "OVERDUE") items.push({ severity: "CRITICAL", category: "deadline", title: `Échéance dépassée : ${d.label}`, ref: { type: "Deadline", id: d.id } });
      else if (st === "DUE_SOON") items.push({ severity: "IMPORTANT", category: "deadline", title: `Échéance proche : ${d.label}`, ref: { type: "Deadline", id: d.id } });
    }
    // Veille : fins de CDD
    for (const c of await this.repo.listContractsByTenant(t)) {
      if (c.type === "CDD" && c.endDate) {
        const st = statusOf(c.endDate);
        if (st === "OVERDUE" || st === "DUE_SOON") items.push({ severity: st === "OVERDUE" ? "CRITICAL" : "IMPORTANT", category: "contract_end", title: "Fin de CDD à anticiper", ref: { type: "Contract", id: c.id } });
      }
    }

    items.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    const counts: Record<Severity, number> = { CRITICAL: 0, IMPORTANT: 0, ACTION: 0, INFO: 0 };
    for (const i of items) counts[i.severity]++;
    return { counts, items };
  }
}
