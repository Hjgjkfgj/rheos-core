// Digital RH Officer : produit un briefing quotidien à partir des données déjà
// présentes (notifications, effectif, événements du jour). Génération
// DÉTERMINISTE et explicable (chaque phrase s'appuie sur des compteurs) ; une
// couche LLM pourra reformuler le texte sans changer les faits (ADR-010).
import { uid } from "./store.js";
import { Repository } from "./repository.js";
import { NotificationService } from "./services-notifications.js";
import { nextThreshold } from "./domain/thresholds.js";
import { Ctx } from "./types.js";

const BRIEFING_VERSION = "briefing-v1";

export class RhOfficerService {
  constructor(private repo: Repository, private notifications: NotificationService) {}

  async briefing(ctx: Ctx) {
    const notif = await this.notifications.build(ctx); // exige notifications.read
    const today = new Date().toISOString().slice(0, 10);

    // Effectif tenant + distance au prochain seuil
    const emps = await this.repo.listEmploymentsByTenant(ctx.tenantId);
    const headcount = emps.filter((e) => e.status !== "ENDED" && e.startDate <= today && (!e.endDate || e.endDate >= today)).length;
    const next = nextThreshold(headcount);

    // Activité du jour
    const events = await this.repo.listDomainEventsByTenant(ctx.tenantId);
    const todays = events.filter((e) => (e.occurredAt ?? "").slice(0, 10) === today);
    const countType = (t: string) => todays.filter((e) => e.type === t).length;
    const activity = { hires: countType("EmployeeHired"), departures: countType("EmployeeDeparture"), contractsSigned: countType("ContractSigned") };

    // Recommandations (déterministes)
    const recommendations: string[] = [];
    const byCat = (c: string) => notif.items.filter((i) => i.category === c).length;
    if (byCat("contract")) recommendations.push(`Faire signer ${byCat("contract")} contrat(s) en attente.`);
    if (byCat("document")) recommendations.push(`Signer ${byCat("document")} document(s) en attente.`);
    if (byCat("leave")) recommendations.push(`Valider ${byCat("leave")} demande(s) de congé.`);
    if (byCat("obligation")) recommendations.push(`Lancer la mise en conformité : ${byCat("obligation")} obligation(s) à traiter.`);
    if (byCat("departure")) recommendations.push(`Préparer ${byCat("departure")} sortie(s) (solde de tout compte, documents).`);
    if (next && next.remaining <= 3) recommendations.push(`Anticiper : plus que ${next.remaining} collaborateur(s) avant le seuil ${next.threshold} (nouvelles obligations).`);

    // Fil narratif
    const pending = notif.items.length;
    const lines = [
      "Bonjour,",
      pending === 0
        ? "aucune action urgente n'est en attente aujourd'hui."
        : `${pending} action(s) en attente, dont ${notif.counts.CRITICAL} critique(s) et ${notif.counts.IMPORTANT} importante(s).`,
      `Effectif actuel : ${headcount}${next ? ` (à ${next.remaining} du seuil ${next.threshold}).` : "."}`,
      `Aujourd'hui : ${activity.hires} embauche(s), ${activity.departures} départ(s), ${activity.contractsSigned} contrat(s) signé(s).`,
    ];

    // Journalisation IA (ADR-010) : données utilisées + version. Aucune écriture métier.
    await this.repo.appendAiAudit({ id: uid(), tenantId: ctx.tenantId, userId: ctx.userId, kind: "BRIEFING", dataUsed: ["employments:tenant", "domainEvents:today", "notifications"], version: BRIEFING_VERSION, outcome: `pending=${pending}`, at: new Date().toISOString() });

    return {
      version: BRIEFING_VERSION,
      date: today,
      narrative: lines.join(" "),
      workforce: { headcount, nextThreshold: next },
      activityToday: activity,
      alerts: notif.counts,
      top: notif.items.slice(0, 5),
      recommendations,
      note: "Briefing déterministe (compteurs vérifiables) ; une couche LLM pourra le reformuler sans altérer les faits.",
    };
  }
}
