// Seuils sociaux → obligations (droit français). INVARIANT #6 : aucune règle
// légale codée en dur — les seuils sont des DONNÉES versionnées et datées
// (effectiveFrom/effectiveTo, source légale). Ce fichier est un SEED indicatif
// « à valider par un juriste » ; à terme alimenté par le moteur réglementaire.
// Le calcul reste déterministe (l'IA n'explique/anticipe qu'à partir de ces règles).

export interface ThresholdObligation { code: string; title: string; source: string; threshold: number }

export interface ThresholdRule {
  threshold: number;
  version: number;
  effectiveFrom: string;   // date d'entrée en vigueur de la règle
  effectiveTo?: string;    // date de fin (règle abrogée) — sinon toujours applicable
  source: string;
  obligations: Omit<ThresholdObligation, "threshold">[];
}

// Seed daté (à valider juriste). effectiveFrom large : ces seuils sont en vigueur
// sur toute la période couverte par le MVP. Une évolution législative = une
// NOUVELLE version datée (l'ancienne reçoit effectiveTo), jamais un écrasement.
export const THRESHOLD_RULES: ThresholdRule[] = [
  { threshold: 11, version: 1, effectiveFrom: "2020-01-01", source: "C. trav. art. L2311-2", obligations: [
    { code: "CSE_ELECTION", title: "Mise en place du CSE (organisation des élections)", source: "C. trav. art. L2311-2" },
  ]},
  { threshold: 20, version: 1, effectiveFrom: "2020-01-01", source: "C. trav. art. L1311-2", obligations: [
    { code: "REGLEMENT_INTERIEUR", title: "Règlement intérieur obligatoire", source: "C. trav. art. L1311-2" },
  ]},
  { threshold: 50, version: 1, effectiveFrom: "2020-01-01", source: "C. trav. art. L2312-8", obligations: [
    { code: "CSE_ATTRIBUTIONS_ELARGIES", title: "CSE à attributions élargies", source: "C. trav. art. L2312-8" },
    { code: "BDESE", title: "Base de données économiques, sociales et environnementales", source: "C. trav. art. L2312-18" },
    { code: "PARTICIPATION", title: "Accord/dispositif de participation", source: "C. trav. art. L3322-2" },
  ]},
  { threshold: 250, version: 1, effectiveFrom: "2020-01-01", source: "C. trav. art. L1142-8", obligations: [
    { code: "REFERENT_HARCELEMENT_EMPLOYEUR", title: "Référent harcèlement sexuel (employeur)", source: "C. trav. art. L1153-5-1" },
    { code: "INDEX_EGAPRO", title: "Index égalité professionnelle F/H", source: "C. trav. art. L1142-8" },
  ]},
];

const today = () => new Date().toISOString().slice(0, 10);

/// Règles en vigueur à une date (sélection datée — jamais de constante figée).
function activeRules(asOf: string): ThresholdRule[] {
  return THRESHOLD_RULES.filter((r) => r.effectiveFrom <= asOf && (!r.effectiveTo || asOf <= r.effectiveTo));
}

/// Obligations applicables pour un effectif à une date (tous seuils atteints).
export function obligationsForHeadcount(headcount: number, asOf: string = today()): ThresholdObligation[] {
  return activeRules(asOf)
    .filter((t) => headcount >= t.threshold)
    .flatMap((t) => t.obligations.map((o) => ({ ...o, threshold: t.threshold })));
}

/// Seuils franchis en passant de `from` à `to` (strictement), à une date.
export function crossedThresholds(from: number, to: number, asOf: string = today()): number[] {
  return activeRules(asOf).map((t) => t.threshold).filter((th) => from < th && to >= th);
}

/// Prochain seuil au-dessus de l'effectif courant (pour l'anticipation).
export function nextThreshold(headcount: number, asOf: string = today()): { threshold: number; remaining: number } | null {
  const ts = activeRules(asOf).map((t) => t.threshold).sort((a, b) => a - b);
  const n = ts.find((t) => t > headcount);
  return n ? { threshold: n, remaining: n - headcount } : null;
}
