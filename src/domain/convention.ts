// Convention collective DATÉE (ADR-004) : la valeur du point et la grille sont
// effective-dated → un calcul à une date passée utilise les valeurs de l'époque.
// Valeurs INDICATIVES pour le MVP ; à alimenter depuis le moteur réglementaire.

export interface PointValue { from: string; value: number }
export interface GridEntry { coef: number; points: number }
interface Convention { idcc: string; label: string; indicative: boolean; valeurPoint: PointValue[]; grid: GridEntry[] }

const CONVENTIONS: Record<string, Convention> = {
  "2216": {
    idcc: "2216",
    label: "Commerce de détail et de gros à prédominance alimentaire",
    indicative: true,
    valeurPoint: [ { from: "2024-01-01", value: 20.0 }, { from: "2026-01-01", value: 20.5 } ],
    grid: [ { coef: 110, points: 90 }, { coef: 130, points: 95 }, { coef: 150, points: 105 }, { coef: 190, points: 130 } ],
  },
  DEFAULT: {
    idcc: "DEFAULT",
    label: "Barème générique (indicatif)",
    indicative: true,
    valeurPoint: [ { from: "2024-01-01", value: 20.0 } ],
    grid: [ { coef: 100, points: 90 }, { coef: 120, points: 95 }, { coef: 140, points: 100 } ],
  },
};

export function getConvention(idcc: string): Convention {
  return CONVENTIONS[idcc] ?? CONVENTIONS.DEFAULT;
}

/// Valeur du point applicable à une date (dernière entrée dont from <= date).
export function resolveValeurPoint(idcc: string, date: string): number {
  const conv = getConvention(idcc);
  const applicable = conv.valeurPoint
    .filter((v) => new Date(v.from) <= new Date(date))
    .sort((a, b) => a.from.localeCompare(b.from));
  return (applicable[applicable.length - 1] ?? conv.valeurPoint[0]).value;
}

/// Minimum mensuel conventionnel pour un coefficient à une date.
export function minimumForCoef(idcc: string, coef: number, date: string): number | undefined {
  const conv = getConvention(idcc);
  const entry = conv.grid.find((g) => g.coef === coef);
  if (!entry) return undefined;
  return Math.round(entry.points * resolveValeurPoint(idcc, date) * 100) / 100;
}

/// Grille (coef → minimum mensuel) résolue à une date.
export function conventionGrid(idcc: string, date: string) {
  const conv = getConvention(idcc);
  const vp = resolveValeurPoint(idcc, date);
  return {
    idcc: conv.idcc, label: conv.label, indicative: conv.indicative, date, valeurPoint: vp,
    grid: conv.grid.map((g) => ({ coef: g.coef, points: g.points, minimumMensuel: Math.round(g.points * vp * 100) / 100 })),
  };
}
