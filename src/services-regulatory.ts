// Rhéos — Référentiel réglementaire (R1, ADR-020). Données PLATEFORME (hors RLS tenant) :
// ingestion versionnée du texte consolidé par IDCC (idempotente par hash) + exposition
// lecture pour tout tenant authentifié. L'ingestion écrit (via l'admin) ; l'app lit seulement.
import { createHash } from "crypto";
import { uid } from "./store.js";
import { EventBus } from "./events.js";
import { Repository } from "./repository.js";
import { RegulatoryRule } from "./types.js";

export interface IngestTextInput {
  idcc: string; kaliId: string; title: string; effectiveDate?: string;
  content: string;           // extrait consolidé (stocké)
  hashInput?: string;        // contenu source complet pour l'empreinte (défaut : content)
  sourceUrl?: string; sourceName?: string;
}

export class RegulatoryService {
  constructor(private repo: Repository, private bus: EventBus) {}

  /// Ingestion IDEMPOTENTE : même empreinte que la version courante → aucun doublon ;
  /// empreinte différente (ou première fois) → nouvelle version + événement.
  async ingestText(input: IngestTextInput): Promise<{ changed: boolean; version: number; hash: string }> {
    const hash = createHash("sha256").update(input.hashInput ?? input.content).digest("hex");
    const latest = await this.repo.getLatestRegulatoryText(input.idcc);
    if (latest && latest.hash === hash) return { changed: false, version: latest.version, hash };
    const version = (latest?.version ?? 0) + 1;
    const fetchedAt = new Date().toISOString();
    await this.repo.createRegulatoryText({
      id: uid(), idcc: input.idcc, kaliId: input.kaliId, title: input.title, version,
      effectiveDate: input.effectiveDate, content: input.content, hash, sourceUrl: input.sourceUrl, fetchedAt,
    });
    await this.repo.createRegulatorySource({ id: uid(), name: input.sourceName ?? "KALI", url: input.sourceUrl ?? "", fetchedAt });
    // Événement PLATEFORME (pas de tenant : tenantId "PLATFORM").
    this.bus.publish("PLATFORM", "RegulatoryText", input.idcc, "RegulatoryTextUpdated", { idcc: input.idcc, version, hash }, "regulatory-ingest");
    return { changed: true, version, hash };
  }

  /// Ajout/mise à jour d'une règle (validée humainement — PR en v1).
  async upsertRule(rule: RegulatoryRule) { return this.repo.createRegulatoryRule(rule); }

  /// Exposition lecture : métadonnées + version courante + règles PUBLIÉES. Aucune donnée
  /// tenant : renvoie la même chose quel que soit le tenant appelant (référentiel partagé).
  async getAgreement(idcc: string) {
    const text = await this.repo.getLatestRegulatoryText(idcc);
    const versions = await this.repo.listRegulatoryTextVersions(idcc);
    const rules = (await this.repo.listRegulatoryRules(idcc)).filter((r) => r.status === "PUBLISHED");
    return {
      idcc,
      source: text ? { name: "KALI", url: text.sourceUrl ?? null } : null,
      currentText: text ? {
        version: text.version, title: text.title, effectiveDate: text.effectiveDate ?? null,
        hash: text.hash, sourceUrl: text.sourceUrl ?? null, fetchedAt: text.fetchedAt,
      } : null,
      versionsCount: versions.length,
      publishedRules: rules.map((r) => ({ type: r.type, params: r.params, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo ?? null, sourceRef: r.sourceRef })),
    };
  }
}
