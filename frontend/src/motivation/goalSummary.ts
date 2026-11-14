export type GoalCountStatus = 'completed' | 'failed' | 'active';

export function isExpiredDueAt(dueAt: string | null | undefined) {
  if (!dueAt) return false;
  const t = new Date(dueAt).getTime();
  return Number.isFinite(t) && t > 0 && t < Date.now();
}

export function classifyVisibleGoal(
  goal: { deletedAt?: string | null; completed?: boolean; failedAt?: string | null; dueAt?: string | null },
  failedMap: Record<string, string | undefined>,
  goalId: string
): GoalCountStatus | 'deleted' {
  if (goal.deletedAt) return 'deleted';
  if (goal.completed) return 'completed';
  if (goal.failedAt || failedMap[goalId] || isExpiredDueAt(goal.dueAt)) return 'failed';
  return 'active';
}

export function countVisibleGoals<T extends { id: string; deletedAt?: string | null; completed?: boolean; failedAt?: string | null; dueAt?: string | null }>(
  goals: T[],
  failedMap: Record<string, string | undefined>
) {
  const counts = { total: 0, completed: 0, active: 0, failed: 0 };
  for (const goal of goals) {
    const status = classifyVisibleGoal(goal, failedMap, goal.id);
    if (status === 'deleted') continue;
    counts.total += 1;
    counts[status] += 1;
  }
  return counts;
}
