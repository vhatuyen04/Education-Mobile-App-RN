const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

export const DELETE_STEP_MESSAGE =
  "Deleting this Step will end it immediately. Your previous completion history will be preserved. If today's scheduled occurrence is unfinished, it will be recorded as missed.";

export function replaceStepCopy(currentEnds: string, nextStarts: string) {
  return {
    title: 'Replace this step?',
    lead: 'Replacing this step will archive the current version and create a new one with its own progress history.',
    records: "Your existing DONE and MISSED records will be preserved. Both versions will contribute to your goal's progress based on their scheduled dates.",
    currentEnds,
    nextStarts,
  };
}

export function readDurationMinutes(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const minutes = Number(trimmed);
  return minutes > 0 ? minutes : 'invalid';
}

export function schedulePhrase(step: {
  dueAt?: string | null;
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
  scheduleText?: string | null;
}): string {
  const repeat = String(step.repeat ?? '').trim().toLowerCase();
  if (repeat === 'daily') return 'Every day';
  if (repeat === 'weekly' && step.repeatDay != null && step.repeatDay >= 0 && step.repeatDay <= 6) {
    return `Every ${WEEKDAYS[step.repeatDay]}`;
  }
  if (repeat === 'monthly' && step.repeatDay) return `Day ${step.repeatDay} of each month`;
  if (repeat === 'yearly' && step.repeatMonth && step.repeatDay) {
    const month = MONTHS[step.repeatMonth - 1] ?? `month ${step.repeatMonth}`;
    return `Every ${month} ${step.repeatDay}`;
  }
  if (step.dueAt) return `Once on ${String(step.dueAt).slice(0, 10)}`;
  const text = String(step.scheduleText ?? '').trim();
  return text || 'No schedule';
}

export function durationPhrase(minutes?: number | null): string {
  return minutes ? `${minutes} min` : 'No duration';
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function formatStepDate(civil: string, today?: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(civil);
  if (!match) return civil;
  const year = Number(match[1]);
  const month = SHORT_MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (!month || !day) return civil;
  const label = `${month} ${day}`;
  const todayYear = today?.slice(0, 4);
  return todayYear && todayYear === match[1] ? label : `${label}, ${year}`;
}

export type StepFact = { label: string; value: string };

function civilDay(value?: string | null): string {
  const day = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

function dateSpan(start: string, end: string, today?: string | null): string {
  if (start === end) return formatStepDate(start, today);
  return `${formatStepDate(start, today)} – ${formatStepDate(end, today)}`;
}

/** Scheduled date is the occurrence. Active dates are the lifecycle window. */
export function stepOverviewFacts(input: {
  step: {
    dueAt?: string | null;
    repeat?: string | null;
    repeatDay?: number | null;
    repeatMonth?: number | null;
    durationMinutes?: number | null;
    scheduleText?: string | null;
  };
  effectiveStart?: string | null;
  effectiveEnd?: string | null;
  today?: string | null;
}): { schedule: StepFact; duration: StepFact | null; range: StepFact | null } {
  const repeat = String(input.step.repeat ?? '').trim().toLowerCase();
  const due = civilDay(input.step.dueAt);
  const once = (!repeat || repeat === 'once') && !!due;
  const start = civilDay(input.effectiveStart);
  const end = civilDay(input.effectiveEnd);
  const today = input.today;
  const schedule = once
    ? { label: 'Scheduled', value: formatStepDate(due, today) }
    : { label: 'Schedule', value: schedulePhrase(input.step) };
  const minutes = input.step.durationMinutes;
  const duration = minutes && minutes > 0 ? { label: 'Duration', value: `${minutes} min` } : null;
  const anchor = once ? due : '';
  const startAdds = !!start && start !== anchor;
  const endAdds = !!end && end !== anchor;
  let range: StepFact | null = null;
  if (!once) {
    if (start && end) range = { label: 'Active', value: dateSpan(start, end, today) };
    else if (start) range = { label: 'Active from', value: formatStepDate(start, today) };
    else if (end) range = { label: 'Active through', value: formatStepDate(end, today) };
  } else if (startAdds && endAdds && start && end) {
    range = { label: 'Active', value: dateSpan(start, end, today) };
  } else if (startAdds && start) {
    range = { label: 'Active from', value: formatStepDate(start, today) };
  } else if (endAdds && end) {
    range = { label: 'Active through', value: formatStepDate(end, today) };
  }
  return { schedule, duration, range };
}
