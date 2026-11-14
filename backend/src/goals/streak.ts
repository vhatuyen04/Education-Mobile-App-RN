export function ymdUtc(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysUtc(ymdStr: string, deltaDays: number) {
  const [yy, mm, dd] = ymdStr.split('-').map(v => Number(v));
  const dt = new Date(Date.UTC(yy, (mm ?? 1) - 1, dd ?? 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return ymdUtc(dt);
}

export function nextGoalStreak(
  user: { goalStreakDays: number; lastGoalCompletedAt: Date | null },
  now: Date
): { goalStreakDays: number; lastGoalCompletedAt: Date } {
  const today = ymdUtc(now);
  const last = user.lastGoalCompletedAt ? ymdUtc(new Date(user.lastGoalCompletedAt)) : null;
  const prevStreak = Number(user.goalStreakDays ?? 0);

  let goalStreakDays = prevStreak;
  if (!last) goalStreakDays = 1;
  else if (last === today) goalStreakDays = prevStreak;
  else if (addDaysUtc(last, 1) === today) goalStreakDays = Math.max(0, prevStreak) + 1;
  else goalStreakDays = 1;

  return { goalStreakDays, lastGoalCompletedAt: now };
}
