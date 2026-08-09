// Préparation des variables de paie (D4). Rhéos AGRÈGE les éléments variables
// d'une période ; le CALCUL (brut→net, cotisations, DSN) est délégué à un moteur
// de paie certifié (ADR-008). Aucune règle de paie n'est implémentée ici.
import { Contract, LeaveRequest, LeaveType } from "../types.js";
import { contractualMonthlyHours } from "./time.js";

export interface Period { year: number; month: number } // month 1-12

const pad = (n: number) => String(n).padStart(2, "0");

export function periodBounds(p: Period): { start: string; end: string } {
  const lastDay = new Date(p.year, p.month, 0).getDate();
  return { start: `${p.year}-${pad(p.month)}-01`, end: `${p.year}-${pad(p.month)}-${pad(lastDay)}` };
}

export function overlapDays(startA: string, endA: string, startB: string, endB: string): number {
  const s = Math.max(new Date(startA).getTime(), new Date(startB).getTime());
  const e = Math.min(new Date(endA).getTime(), new Date(endB).getTime());
  if (e < s) return 0;
  return Math.floor((e - s) / 86400000) + 1;
}

function monthsBetween(from: string, to: string): number {
  const a = new Date(from), b = new Date(to);
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()));
}

export interface PayrollInput {
  employmentId: string;
  period: string;
  base: { grossMonthly?: number; workingTime?: number; workingTimeUnit?: string; classification?: string; coefficient?: number };
  seniorityMonths: number;
  leaves: { type: LeaveType; days: number }[];
  unpaidDays: number;
  plannedHours: number;
  workedHours: number;
  overtimeHours: number;
  note: string;
}

export function buildPayrollInput(args: {
  employmentId: string; employmentStart: string; contract?: Contract; approvedLeaves: LeaveRequest[];
  plannedHours?: number; workedHours?: number; period: Period;
}): PayrollInput {
  const { start, end } = periodBounds(args.period);
  const byType = new Map<LeaveType, number>();
  for (const l of args.approvedLeaves) {
    const d = overlapDays(l.startDate, l.endDate, start, end);
    if (d > 0) byType.set(l.type, (byType.get(l.type) ?? 0) + d);
  }
  const leaves = [...byType.entries()].map(([type, days]) => ({ type, days }));
  const workedHours = args.workedHours ?? 0;
  const monthly = contractualMonthlyHours(args.contract?.workingTime, args.contract?.workingTimeUnit);
  const overtimeHours = monthly != null ? Math.max(0, Math.round((workedHours - monthly) * 100) / 100) : 0;
  return {
    employmentId: args.employmentId,
    period: `${args.period.year}-${pad(args.period.month)}`,
    base: {
      grossMonthly: args.contract?.grossMonthly,
      workingTime: args.contract?.workingTime,
      workingTimeUnit: args.contract?.workingTimeUnit,
      classification: args.contract?.classification,
      coefficient: args.contract?.coefficient,
    },
    seniorityMonths: monthsBetween(args.employmentStart, end),
    leaves,
    unpaidDays: byType.get("UNPAID") ?? 0,
    plannedHours: args.plannedHours ?? 0,
    workedHours,
    overtimeHours,
    note: "Éléments variables préparés par Rhéos — calcul et DSN délégués à un moteur de paie certifié (ADR-008).",
  };
}
