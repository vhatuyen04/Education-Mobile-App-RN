export function goalProgressLabel(goal: { dueAt?: string | null; progressPct?: number | null }): string {
  if (!goal.dueAt) return 'No deadline';
  const pct = Number(goal.progressPct ?? 0);
  const shown = Number.isFinite(pct) ? pct.toFixed(2) : '0.00';
  return `Progress: ${shown}%`;
}
