import type { AiGoalStepSchedule, AiGoalSuggestion } from '../api/auth';

function formatWeekday(d: number | undefined) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (d === undefined || d === null) return '';
  const idx = Number(d);
  if (!Number.isFinite(idx) || idx < 0 || idx > 6) return '';
  return days[idx];
}

export function scheduleToShortText(s?: AiGoalStepSchedule) {
  if (!s || s.type === 'none') return '';
  if (s.type === 'once') return `once:${s.due}`;
  if (s.repeat === 'custom') return `custom:${(s.customDates ?? []).join(',')}`;
  const r = (s.repeat ?? '').trim();
  // Drop AI placeholder/template schedule strings.
  const rLowerAll = r.toLowerCase();
  const tokenHits = [
    rLowerAll.includes('daily'),
    rLowerAll.includes('weekly'),
    rLowerAll.includes('monthly'),
    rLowerAll.includes('yearly'),
    rLowerAll.includes('once'),
  ].filter(Boolean).length;
  if (/[|｜¦∣]/.test(r) || tokenHits >= 2) return '';
  const rLower = r.toLowerCase();
  if (rLower === 'daily') return 'daily';
  if (rLower === 'weekly') {
    const days = s.repeatDays?.length ? s.repeatDays : s.repeatDay !== undefined ? [s.repeatDay] : [];
    const names = [...days].sort((left, right) => ((left + 6) % 7) - ((right + 6) % 7)).map(day => formatWeekday(day)).filter(Boolean);
    return names.length ? `weekly:${names.join(',')}` : 'weekly';
  }
  if (rLower === 'monthly') {
    const days = s.repeatDays?.length ? [...s.repeatDays].sort((left, right) => left - right) : s.repeatDay !== undefined ? [s.repeatDay] : [];
    return days.length ? `monthly:${days.join(',')}` : 'monthly';
  }
  if (rLower === 'yearly') {
    const mm = s.repeatMonth !== undefined ? String(s.repeatMonth).padStart(2, '0') : '';
    const dd = s.repeatDay !== undefined ? String(s.repeatDay).padStart(2, '0') : '';
    return mm && dd ? `yearly:${mm}-${dd}` : 'yearly';
  }
  return `repeat:${r}`;
}

export function preparePlannerDraft(
  suggestion: Pick<AiGoalSuggestion, 'deadline' | 'steps'>,
  resolvedDeadline?: string
) {
  return {
    deadline: resolvedDeadline || suggestion.deadline,
    steps: suggestion.steps.map(step => ({
      ...step,
      description: String(step.description ?? '').trim(),
      scheduleText: scheduleToShortText(step.schedule),
    })),
  };
}
