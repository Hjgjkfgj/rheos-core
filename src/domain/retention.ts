// Rétention documentaire RGPD : durée légale de conservation par type de document.
// Durées de référence (droit français) — bulletin de paie dématérialisé : 50 ans ;
// contrats/documents RH : 5 ans après la fin de la relation. À affiner par le
// moteur réglementaire ; ne jamais purger un document sous legal hold.
import { DocumentType } from "../types.js";

// RetentionPolicy par type : durée + événement déclencheur (basis) + legal hold
// par défaut. SEED indicatif « À VALIDER PAR UN JURISTE » (invariant #6 : durées
// = données, jamais des constantes métier codées en dur ailleurs).
type Basis = "deposit" | "employmentEnd";
export interface RetentionPolicy { years: number; basis: Basis; trigger: string; legalHoldByDefault?: boolean; toValidateByLegal: true }
export const RETENTION: Record<DocumentType, RetentionPolicy> = {
  PAYSLIP:        { years: 50, basis: "deposit",       trigger: "DocumentDeposited", toValidateByLegal: true }, // bulletin dématérialisé
  CONTRACT:       { years: 5,  basis: "employmentEnd", trigger: "EmployeeDeparture", toValidateByLegal: true },
  AMENDMENT:      { years: 5,  basis: "employmentEnd", trigger: "EmployeeDeparture", toValidateByLegal: true },
  CERTIFICATE:    { years: 5,  basis: "deposit",       trigger: "DocumentDeposited", toValidateByLegal: true },
  ID_DOCUMENT:    { years: 5,  basis: "employmentEnd", trigger: "EmployeeDeparture", toValidateByLegal: true },
  ADMINISTRATIVE: { years: 5,  basis: "deposit",       trigger: "DocumentDeposited", toValidateByLegal: true },
  OTHER:          { years: 5,  basis: "deposit",       trigger: "DocumentDeposited", toValidateByLegal: true },
};

export function retentionPolicyFor(type: DocumentType): RetentionPolicy { return RETENTION[type]; }

const addYears = (iso: string, years: number) => {
  const d = new Date(iso); d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
};

/// Calcule la date de fin de conservation. Renvoie undefined si la base
/// (fin de relation) n'est pas encore connue → à fixer au départ du collaborateur.
export function computeRetentionUntil(type: DocumentType, ctx: { depositDate: string; employmentEndDate?: string }): string | undefined {
  const rule = RETENTION[type];
  const base = rule.basis === "deposit" ? ctx.depositDate : ctx.employmentEndDate;
  if (!base) return undefined;
  return addYears(base, rule.years);
}

/// Documents dont la conservation est échue à une date donnée (candidats à la purge).
export function purgeCandidates<T extends { retentionUntil?: string }>(docs: T[], asOf: string): T[] {
  return docs.filter((d) => d.retentionUntil && new Date(d.retentionUntil) < new Date(asOf));
}
