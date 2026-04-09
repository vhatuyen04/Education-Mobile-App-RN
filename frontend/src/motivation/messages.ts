import type { ProgressEvent } from './progress';

function pick(list: string[]) {
  return list[Math.floor(Math.random() * list.length)] ?? '';
}

export function messageForProgressEvent(ev: ProgressEvent) {
  if (ev.type === 'step_done') {
    const base = pick([
      'Nice work. Small steps add up.',
      'Proud of you for showing up today.',
      'That’s momentum. Keep it going.',
      'Good job. You’re building discipline.',
    ]);

    return `SmartGoal: ${base}`;
  }

  if (ev.type === 'step_undone') {
    return 'SmartGoal: No problem. Adjusting is part of the process.';
  }

  const base = pick([
    'Big win. You finished a goal.',
    'Goal completed. That’s real progress.',
    'You did it. I’m genuinely impressed.',
  ]);
  const streak = ev.goalStreakChanged
    ? ` Goal streak: ${ev.newProgress.goalStreakDays} day${ev.newProgress.goalStreakDays === 1 ? '' : 's'}.`
    : '';
  return `SmartGoal: ${base} +${ev.xpDelta} XP.${streak}`;
}
