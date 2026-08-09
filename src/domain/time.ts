// Calculs de temps (D3). Heures décimales à partir de "HH:MM".
export function hoursBetween(start: string, end: string): number {
  const [h1, m1] = start.split(":").map(Number);
  const [h2, m2] = end.split(":").map(Number);
  const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  return Math.round((mins / 60) * 100) / 100;
}

const inMonth = (date: string, year: number, month: number) =>
  date.slice(0, 7) === `${year}-${String(month).padStart(2, "0")}`;

export function sumHoursInMonth<T extends { date: string; hours: number }>(rows: T[], year: number, month: number): number {
  return Math.round(rows.filter((r) => inMonth(r.date, year, month)).reduce((s, r) => s + r.hours, 0) * 100) / 100;
}

/// Base mensuelle contractuelle indicative (35 h/sem → ~151,67 h/mois).
export function contractualMonthlyHours(workingTime?: number, unit?: string): number | undefined {
  if (workingTime == null) return undefined;
  if (unit === "HOURS_PER_MONTH") return workingTime;
  if (unit === "HOURS_PER_WEEK") return Math.round((workingTime * 52 / 12) * 100) / 100;
  return undefined; // forfait jours : non applicable ici
}
