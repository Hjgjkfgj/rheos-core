// Utilitaires de veille : statut d'une échéance selon sa date.
export type EcheanceStatus = "OVERDUE" | "DUE_SOON" | "UPCOMING";

export function daysUntil(dueDate: string, today = new Date().toISOString().slice(0, 10)): number {
  return Math.floor((new Date(dueDate).getTime() - new Date(today).getTime()) / 86400000);
}

export function statusOf(dueDate: string, soonDays = 60, today?: string): EcheanceStatus {
  const d = daysUntil(dueDate, today);
  if (d < 0) return "OVERDUE";
  if (d <= soonDays) return "DUE_SOON";
  return "UPCOMING";
}
