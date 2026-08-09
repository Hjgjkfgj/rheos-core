// Socle Temps — moteur congés/absences (spec docs/spec-absences.md, validée).
// INVARIANT #6 : aucune valeur légale en dur ailleurs — tout est configuration
// DATÉE ci-dessous (seed « à valider juriste »). Décompte OUVRABLES par défaut
// (validé), période de référence légale 1er juin → 31 mai.
import { LeaveType } from "../types.js";

// --- Politique par type d'absence (datée) ------------------------------------
export interface LeaveTypePolicy { paid: boolean; decremented: boolean; entitlementDays: number; effectiveFrom: string; toValidateByLegal: true }
export const LEAVE_TYPE_POLICY: Record<LeaveType, LeaveTypePolicy> = {
  PAID:   { paid: true,  decremented: true,  entitlementDays: 30, effectiveFrom: "2020-06-01", toValidateByLegal: true }, // 30 j ouvrables
  RTT:    { paid: true,  decremented: true,  entitlementDays: 10, effectiveFrom: "2020-01-01", toValidateByLegal: true },
  SICK:   { paid: false, decremented: false, entitlementDays: 0,  effectiveFrom: "2020-01-01", toValidateByLegal: true }, // subrogation hors périmètre
  UNPAID: { paid: false, decremented: false, entitlementDays: 0,  effectiveFrom: "2020-01-01", toValidateByLegal: true },
  FAMILY_EVENT: { paid: true, decremented: false, entitlementDays: 0, effectiveFrom: "2020-01-01", toValidateByLegal: true }, // droit dédié daté (barème FamilyEventRule)
};

// --- Politique d'acquisition (datée) -----------------------------------------
export const ACCRUAL_POLICY = {
  referenceStart: "06-01",       // 1er juin (légal, validé)
  accrualPerMonth: 2.5,          // 2,5 jours ouvrables / mois
  decountMode: "OUVRABLES" as "OUVRABLES" | "OUVRES",
  carryover: "LOSS" as const,    // perte au terme (validé, sauf exceptions légales)
  toValidateByLegal: true as const,
};

// --- Politique de validation (datée) -----------------------------------------
export const APPROVAL_POLICY = { requiresHr: false, toValidateByLegal: true as const }; // manager suffit par défaut (validé)

// --- Calendrier d'entreprise (seed France, daté « à valider juriste ») --------
export interface Holiday { date: string; label: string; worked: boolean }
export const HOLIDAYS_FR_2026: Holiday[] = [
  { date: "2026-01-01", label: "Jour de l'an", worked: false },
  { date: "2026-04-06", label: "Lundi de Pâques", worked: false },
  { date: "2026-05-01", label: "Fête du Travail", worked: false },
  { date: "2026-05-08", label: "Victoire 1945", worked: false },
  { date: "2026-05-14", label: "Ascension", worked: false },
  { date: "2026-05-25", label: "Lundi de Pentecôte", worked: false },
  { date: "2026-07-14", label: "Fête nationale", worked: false },
  { date: "2026-08-15", label: "Assomption", worked: false },
  { date: "2026-11-01", label: "Toussaint", worked: false },
  { date: "2026-11-11", label: "Armistice 1918", worked: false },
  { date: "2026-12-25", label: "Noël", worked: false },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/// Décompte des jours d'absence entre start et end (inclus), en OUVRABLES par
/// défaut (lun→sam ; dimanche exclu) ou OUVRÉS (lun→ven), hors jours fériés chômés
/// et jours de fermeture. Fonction pure et déterministe.
export function countLeaveDays(start: string, end: string, opts: { mode?: "OUVRABLES" | "OUVRES"; holidays?: Holiday[]; closures?: string[] } = {}): number {
  const mode = opts.mode ?? ACCRUAL_POLICY.decountMode;
  const chomes = new Set((opts.holidays ?? HOLIDAYS_FR_2026).filter((h) => !h.worked).map((h) => h.date));
  const closures = new Set(opts.closures ?? []);
  let count = 0;
  for (let d = new Date(start + "T00:00:00Z"); iso(d) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay(); // 0 = dimanche, 6 = samedi
    if (dow === 0) continue;                          // dimanche exclu (ouvrables & ouvrés)
    if (mode === "OUVRES" && dow === 6) continue;     // samedi exclu en ouvrés
    const day = iso(d);
    if (chomes.has(day) || closures.has(day)) continue;
    count++;
  }
  return count;
}

/// Période de référence contenant `date` (1er juin → 31 mai).
export function referencePeriod(date: string): { start: string; end: string } {
  const y = Number(date.slice(0, 4));
  const startYear = date.slice(5) >= ACCRUAL_POLICY.referenceStart ? y : y - 1;
  return { start: `${startYear}-06-01`, end: `${startYear + 1}-05-31` };
}

/// Droit acquis (MVP : droit annuel ouvert sur la période si l'emploi la
/// chevauche ; proration fine par temps de présence = raffinement documenté).
export function acquiredDays(type: LeaveType, employmentStart: string, employmentEnd: string | undefined, asOf: string): number {
  const policy = LEAVE_TYPE_POLICY[type];
  if (!policy?.decremented) return 0;
  const p = referencePeriod(asOf);
  const overlaps = employmentStart <= p.end && (!employmentEnd || employmentEnd >= p.start);
  return overlaps ? policy.entitlementDays : 0;
}
