// Assistant de lecture (IA cadrée R2, ADR-010). Principes NON négociables :
//  - Réponses UNIQUEMENT à partir des données AUTORISÉES de l'utilisateur ;
//    les permissions sont appliquées AVANT de constituer le contexte.
//  - L'IA n'écrit JAMAIS en base (aucun appel de mutation ici).
//  - Tout contenu de document est une DONNÉE non fiable, jamais une instruction
//    (anti prompt-injection) : l'assistant ne lit que des métadonnées, jamais le
//    corps d'un document, et ne suit aucune consigne trouvée dans les données.
//  - Hors périmètre / donnée sensible → refus explicite et traçable.
//  - Chaque interaction est journalisée (données utilisées, version).
import { uid } from "./store.js";
import { Repository } from "./repository.js";
import { MvpServices } from "./services-mvp.js";
import { can } from "./auth.js";
import { Ctx, AiAuditLog } from "./types.js";

const VERSION = "assistant-r2-v1";
const REFUSAL = "Je ne dispose pas d'une information suffisamment fiable pour répondre. Voici où vérifier :";

type Intent = "CONTRACT" | "LEAVE" | "DOCUMENTS" | "PLANNING" | "WORKFORCE" | "SENSITIVE" | "OTHER_PERSON" | "UNKNOWN";

// Mots-clés d'intention (données FR nécessaires au matching de questions en
// français). Déclarés en CHAÎNES (pas d'identifiants FR ; ADR-002 respecté).
const KEYWORDS: Record<string, string[]> = {
  SENSITIVE: ["iban", "rib", "nir", "sécurité sociale", "numéro de sécu", "coordonnées bancaires"],
  ABOUT_OTHER: ["salaire", "contrat", "congé", "dossier", "iban", "adresse", "téléphone"],
  CONTRACT: ["contrat", "cdi", "cdd", "temps de travail"],
  LEAVE: ["congé", "congés", "solde", "rtt", "absence"],
  DOCUMENTS: ["document", "documents", "bulletin", "attestation", "coffre"],
  PLANNING: ["planning", "créneau", "horaire", "pointage"],
  WORKFORCE: ["effectif", "seuil", "combien de collaborateur"],
};
const NAME_REFERENCE = /\b(de|d'|pour)\s+[A-ZÀ-Ý]/; // « … de Jean » : cible un tiers

// Détection d'intention déterministe. Aucune exécution de consigne contenue dans
// la question : on classe puis on récupère des faits autorisés.
function detectIntent(q: string): Intent {
  const t = q.toLowerCase();
  const hits = (k: string) => KEYWORDS[k].some((w) => t.includes(w));
  if (hits("SENSITIVE")) return "SENSITIVE";
  if (NAME_REFERENCE.test(q) && hits("ABOUT_OTHER")) return "OTHER_PERSON";
  if (hits("CONTRACT")) return "CONTRACT";
  if (hits("LEAVE")) return "LEAVE";
  if (hits("DOCUMENTS")) return "DOCUMENTS";
  if (hits("PLANNING")) return "PLANNING";
  if (hits("WORKFORCE")) return "WORKFORCE";
  return "UNKNOWN";
}

export class AssistantService {
  constructor(private repo: Repository, private mvp: MvpServices) {}

  private async log(ctx: Ctx, query: string, dataUsed: string[], outcome: string) {
    const entry: AiAuditLog = { id: uid(), tenantId: ctx.tenantId, userId: ctx.userId, kind: "ASSISTANT", query, dataUsed, version: VERSION, outcome, at: new Date().toISOString() };
    await this.repo.appendAiAudit(entry); // journalisation (pas une donnée métier)
    return entry;
  }

  private refuse(pointer: string) {
    return { refused: true, answer: `${REFUSAL} ${pointer}`, facts: null as any, sources: [] as string[], version: VERSION };
  }

  async ask(ctx: Ctx, question: string) {
    const q = String(question ?? "");
    const intent = detectIntent(q);

    // Refus explicites (hors périmètre / hors droits) — AVANT tout accès aux données.
    if (intent === "SENSITIVE") {
      await this.log(ctx, q, [], "refused_sensitive");
      return this.refuse("les données sensibles (IBAN, NIR) ne sont pas accessibles ici — voir la section sécurisée de votre dossier, sur demande auprès des RH.");
    }
    if (intent === "OTHER_PERSON") {
      await this.log(ctx, q, [], "refused_out_of_scope");
      return this.refuse("vous ne pouvez consulter que vos propres données ; adressez-vous aux RH pour une information concernant un tiers.");
    }

    // Faits sur l'effectif : nécessite la permission de lecture entreprise.
    if (intent === "WORKFORCE") {
      if (!can(ctx, "company.read")) { await this.log(ctx, q, [], "refused_no_permission"); return this.refuse("cette information relève des RH (droit de lecture entreprise requis)."); }
      const emps = await this.repo.listEmploymentsByTenant(ctx.tenantId);
      const today = new Date().toISOString().slice(0, 10);
      const headcount = emps.filter((e) => e.status !== "ENDED" && e.startDate <= today && (!e.endDate || e.endDate >= today)).length;
      await this.log(ctx, q, ["employments:tenant"], "answered_workforce");
      return { refused: false, answer: `Effectif actuel : ${headcount} collaborateur(s).`, facts: { headcount }, sources: ["Employment (calcul)"], version: VERSION };
    }

    // Faits personnels : self-scope strict (résolus depuis le jeton, jamais un paramètre).
    const selfIntents: Intent[] = ["CONTRACT", "LEAVE", "DOCUMENTS", "PLANNING"];
    if (selfIntents.includes(intent)) {
      if (!ctx.personId) { await this.log(ctx, q, [], "refused_no_self"); return this.refuse("cet assistant répond au collaborateur sur ses propres données ; aucun collaborateur n'est rattaché à ce compte."); }
      const emp = await this.repo.findActiveEmploymentByPerson(ctx.tenantId, ctx.personId);
      if (!emp) { await this.log(ctx, q, [], "refused_no_employment"); return this.refuse("aucun contrat rattaché à votre compte."); }

      if (intent === "CONTRACT") {
        const c = (await this.repo.listContractsByEmployment(ctx.tenantId, emp.id)).sort((a, b) => a.startDate.localeCompare(b.startDate)).pop();
        await this.log(ctx, q, [`contract:${c?.id ?? "none"}`], "answered_contract");
        return c
          ? { refused: false, answer: `Votre contrat : ${c.type}, temps de travail ${c.workingTime ?? "—"} h, statut ${c.status}.`, facts: { type: c.type, workingTime: c.workingTime, status: c.status }, sources: [`Contract ${c.id}`], version: VERSION }
          : this.refuse("aucun contrat enregistré ; contactez les RH.");
      }
      if (intent === "LEAVE") {
        const bal = await this.mvp.leaveBalance(ctx, emp.id, "PAID");
        await this.log(ctx, q, [`leave-balance:${emp.id}:PAID`], "answered_leave");
        return { refused: false, answer: `Solde de congés payés : ${bal.remaining} jour(s) (acquis ${bal.acquired}, pris ${bal.taken}).`, facts: bal, sources: ["LeaveLedger (rejeu)"], version: VERSION };
      }
      if (intent === "DOCUMENTS") {
        // Métadonnées uniquement — jamais le contenu (WORM + anti-injection).
        const docs = await this.repo.listDocumentsByPerson(ctx.tenantId, ctx.personId);
        await this.log(ctx, q, [`documents:${ctx.personId}`], "answered_documents");
        return { refused: false, answer: `Vous avez ${docs.length} document(s) dans votre coffre-fort.`, facts: { count: docs.length, types: docs.map((d) => d.type) }, sources: ["Document (métadonnées)"], version: VERSION };
      }
      if (intent === "PLANNING") {
        const shifts = await this.repo.listShiftsByEmployment(ctx.tenantId, emp.id);
        await this.log(ctx, q, [`shifts:${emp.id}`], "answered_planning");
        return { refused: false, answer: `${shifts.length} créneau(x) planifié(s).`, facts: { count: shifts.length }, sources: ["Shift"], version: VERSION };
      }
    }

    await this.log(ctx, q, [], "refused_unknown");
    return this.refuse("reformulez votre question (contrat, congés, documents, planning) ou contactez les RH.");
  }
}
