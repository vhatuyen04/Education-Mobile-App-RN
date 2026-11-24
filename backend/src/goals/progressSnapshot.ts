/**
 * Civil-date progress snapshot for TDK recovery experiments.
 *
 * Dates are Gregorian calendar dates written YYYY-MM-DD. Arithmetic uses UTC
 * calendar fields so the result does not depend on the host timezone.
 * Weekday index matches GoalStep.repeatDay: 0 = Sunday … 6 = Saturday.
 *
 * A repeating occurrence exists only from the later of goal.createdAt and
 * step.createdAt through goal.deadline (inclusive). When step.createdAt is
 * omitted, the goal creation date is used so older snapshots stay stable.
 * An open deadline has no end. The emitted window
 * is further clipped by pastHorizonDays and futureHorizonDays (default 14)
 * so a long history cannot expand without bound. A completion on a real
 * scheduled date outside that window is kept in completionsOutsideWindow.
 * It is not treated as unscheduled.
 *
 * Weekly, monthly, and yearly rules that omit a required day or month are
 * ambiguous and produce no occurrences. Monthly day 31 and yearly February 29
 * use recurrence policy clamp-last-valid-day-v1: a short month uses its last
 * valid day, and a non-leap February 29 is February 28. An impossible yearly
 * date such as February 30 stays ambiguous and is not rewritten.
 *
 * GoalStep.done is not an input and is never read.
 */

import {
  RECURRENCE_POLICY_VERSION,
  RECURRENCE_START_POLICY,
  clampedMonthDay,
  isCalendarMonthDay,
  prepareCustomDates,
} from './recurrenceSchedule.js';

export const SNAPSHOT_VERSION = '0.1' as const;
export const DATE_CONVENTION = 'civil-date' as const;
export { RECURRENCE_POLICY_VERSION, RECURRENCE_START_POLICY };
export const DEFAULT_HORIZON_DAYS = 14;

const WEEKDAY_INDEX = '0=Sunday..6=Saturday';
const MISSING_FIELDS = [
  'workloadLimit',
  'taskDurationMinutes',
  'timeOfDay',
  'userPreferences',
  'verifiedAchievement',
] as const;

export type CivilDateString = string;
export type OccurrenceStatus = 'DONE' | 'MISSED' | 'TODO' | 'FUTURE';
export type OccurrenceEvidence = 'self_report' | 'no_completion_row';
export type StepOccurrenceStatus = 'scheduled' | 'unscheduled' | 'ambiguous';

export type RepeatName = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type SnapshotSchedule =
  | { type: 'once'; due: CivilDateString }
  | { type: 'repeat'; repeat: 'daily' }
  | { type: 'repeat'; repeat: 'weekly'; repeatDay: number }
  | { type: 'repeat'; repeat: 'monthly'; repeatDay: number }
  | { type: 'repeat'; repeat: 'yearly'; repeatMonth: number; repeatDay: number }
  | { type: 'custom'; dates: CivilDateString[] }
  | { type: 'none' };

export type ProgressSnapshotGoal = {
  id: string;
  title: string;
  createdAt: CivilDateString;
  deadline: CivilDateString | null;
  completed: boolean;
  failedAt: CivilDateString | null;
};

export type ProgressSnapshotStep = {
  id: string;
  order: number;
  text: string;
  description: string | null;
  dueAt: CivilDateString | null;
  repeat: string | null;
  repeatDay: number | null;
  repeatMonth: number | null;
  /** Explicit YYYY-MM-DD occurrences when repeat is custom. */
  customDates?: string[] | null;
  /** Civil creation date. Omitted means the goal creation date is the start. */
  createdAt?: CivilDateString | null;
  /** Inclusive first civil date for a replacement. Omitted on an ordinary step. */
  effectiveFrom?: CivilDateString | null;
  /** Inclusive last civil date after archive. */
  effectiveUntil?: CivilDateString | null;
  /** Civil date of the archive instant. A later asOf is required before it applies. */
  archivedOn?: CivilDateString | null;
};

export type ProgressSnapshotCompletion = {
  stepId: string;
  date: string;
};

export type BuildProgressSnapshotInput = {
  goal: ProgressSnapshotGoal;
  steps: ProgressSnapshotStep[];
  completions: ProgressSnapshotCompletion[];
  asOf: CivilDateString;
  /** Days after asOf still expanded. Default 14. */
  futureHorizonDays?: number;
  /** Days before asOf still expanded. Default 14. */
  pastHorizonDays?: number;
};

export type ProgressOccurrence = {
  stepId: string;
  date: CivilDateString;
  status: OccurrenceStatus;
  evidence: OccurrenceEvidence;
};

export type SnapshotStep = {
  id: string;
  order: number;
  text: string;
  description: string | null;
  schedule: SnapshotSchedule;
  occurrenceStatus: StepOccurrenceStatus;
  ambiguity: string | null;
  lifecycle?: 'active' | 'archived';
};

export type UnscheduledCompletion = {
  stepId: string;
  date: string;
  evidence: 'self_report';
  reason: 'not_a_scheduled_date' | 'unknown_step' | 'unparseable_date' | 'ambiguous_schedule';
};

export type OutsideWindowCompletion = {
  stepId: string;
  date: CivilDateString;
  evidence: 'self_report';
  scheduled: true;
};

export type AmbiguousStep = {
  stepId: string;
  reason: string;
};

export type ProgressSnapshot = {
  snapshotVersion: typeof SNAPSHOT_VERSION;
  recurrencePolicy: typeof RECURRENCE_POLICY_VERSION;
  recurrenceStartPolicy: typeof RECURRENCE_START_POLICY;
  asOf: CivilDateString;
  dateConvention: typeof DATE_CONVENTION;
  weekdayIndex: typeof WEEKDAY_INDEX;
  window: {
    from: CivilDateString | null;
    to: CivilDateString | null;
    futureHorizonDays: number;
    pastHorizonDays: number;
    goalCreatedAt: CivilDateString;
    goalDeadline: CivilDateString | null;
    horizonEnd: CivilDateString;
    truncatedPast: boolean;
    truncatedFuture: boolean;
    rule: string;
  };
  goal: {
    id: string;
    title: string;
    deadline: CivilDateString | null;
    completed: boolean;
    failedAt: CivilDateString | null;
    completionEvidence: 'stored_flag_only';
  };
  steps: SnapshotStep[];
  occurrences: ProgressOccurrence[];
  summary: {
    done: number;
    missed: number;
    todo: number;
    future: number;
    total: number;
  };
  unscheduledCompletions: UnscheduledCompletion[];
  completionsOutsideWindow: OutsideWindowCompletion[];
  ambiguousSteps: AmbiguousStep[];
  constraints: {
    goalDeadline: CivilDateString | null;
    schedules: 'step_rows';
    workloadLimit: null;
    taskDurationMinutes: null;
    userPreferences: null;
    verifiedAchievement: null;
  };
  missing: string[];
  limitations: string[];
  /** Present when a step carries archive or replacement bounds. */
  lifecyclePolicy?: 'immutable-step-archive-v1';
};

type Civil = { y: number; m: number; d: number };

type DefiniteSchedule =
  | { kind: 'once'; due: Civil }
  | { kind: 'daily' }
  | { kind: 'weekly'; repeatDay: number }
  | { kind: 'monthly'; repeatDay: number }
  | { kind: 'yearly'; repeatMonth: number; repeatDay: number }
  | { kind: 'custom'; dates: string[] };

type ClassifiedStep = {
  step: ProgressSnapshotStep;
  schedule: DefiniteSchedule | null;
  ambiguity: string | null;
  occurrenceStatus: StepOccurrenceStatus;
};

export function buildProgressSnapshot(input: BuildProgressSnapshotInput): ProgressSnapshot {
  const asOf = requireCivil(input.asOf, 'asOf');
  const createdAt = requireCivil(input.goal.createdAt, 'goal.createdAt');
  const deadline = input.goal.deadline == null ? null : requireCivil(input.goal.deadline, 'goal.deadline');
  const futureHorizonDays = requireHorizon(input.futureHorizonDays, 'futureHorizonDays');
  const pastHorizonDays = requireHorizon(input.pastHorizonDays, 'pastHorizonDays');
  const failedAt = parseOptionalCivil(input.goal.failedAt);

  const horizonEnd = addDays(asOf, futureHorizonDays);
  const horizonStart = addDays(asOf, -pastHorizonDays);
  const windowFrom = maxCivil(createdAt, horizonStart);
  const windowTo = deadline == null ? horizonEnd : minCivil(deadline, horizonEnd);
  const inverted = compareCivil(windowFrom, windowTo) > 0;

  const classified = classifySteps(input.steps);
  const byId = new Map<string, ClassifiedStep>();
  const limitations = new Set<string>([
    'recorded_step_completion_is_self_report',
    'goal_completed_is_a_stored_flag_not_step_progress',
    'no_duration_workload_or_preferences_in_source_data',
    'short_months_clamp_to_last_valid_day',
    'goal_step_done_flag_is_not_a_completion_source',
  ]);
  if (failedAt.invalid) limitations.add('invalid_failed_at');
  if (deadline != null && compareCivil(deadline, createdAt) < 0) limitations.add('deadline_before_created');
  if (!inverted && compareCivil(createdAt, windowFrom) < 0) limitations.add('history_truncated_by_past_horizon');
  if (deadline == null || compareCivil(deadline, horizonEnd) > 0) limitations.add('future_truncated_by_study_horizon');

  for (const item of classified) {
    if (byId.has(item.step.id)) {
      limitations.add('duplicate_step_id');
      continue;
    }
    byId.set(item.step.id, item);
  }

  const doneKeys = new Set<string>();
  const unscheduled: UnscheduledCompletion[] = [];
  const outside: OutsideWindowCompletion[] = [];
  const seenCompletion = new Set<string>();

  for (const completion of input.completions) {
    const rawDate = String(completion.date ?? '');
    const key = `${completion.stepId}|${rawDate}`;
    if (seenCompletion.has(key)) {
      limitations.add('duplicate_completions_collapsed');
      continue;
    }
    seenCompletion.add(key);

    const date = parseCivil(rawDate);
    const owner = byId.get(completion.stepId);
    if (!date) {
      unscheduled.push({ stepId: completion.stepId, date: rawDate, evidence: 'self_report', reason: 'unparseable_date' });
      continue;
    }
    if (!owner) {
      unscheduled.push({ stepId: completion.stepId, date: formatCivil(date), evidence: 'self_report', reason: 'unknown_step' });
      continue;
    }
    if (!owner.schedule) {
      unscheduled.push({
        stepId: completion.stepId,
        date: formatCivil(date),
        evidence: 'self_report',
        reason: owner.ambiguity ? 'ambiguous_schedule' : 'not_a_scheduled_date',
      });
      continue;
    }
    const ownerLife = lifecycleBounds(owner.step, createdAt, deadline, asOf);
    if (!knownAt(owner.step, asOf) || !scheduledOn(owner.schedule, date, ownerLife.start, ownerLife.end) || (hasLifecycle(owner.step) && ((compareCivil(date, ownerLife.start) < 0) || (!!ownerLife.end && compareCivil(date, ownerLife.end) > 0)))) {
      unscheduled.push({
        stepId: completion.stepId,
        date: formatCivil(date),
        evidence: 'self_report',
        reason: 'not_a_scheduled_date',
      });
      continue;
    }
    if (inverted || compareCivil(date, windowFrom) < 0 || compareCivil(date, windowTo) > 0) {
      outside.push({ stepId: completion.stepId, date: formatCivil(date), evidence: 'self_report', scheduled: true });
      continue;
    }
    doneKeys.add(`${completion.stepId}|${formatCivil(date)}`);
  }

  const occurrences: ProgressOccurrence[] = [];
  if (!inverted) {
    for (const date of eachDate(windowFrom, windowTo)) {
      for (const item of classified) {
        if (!item.schedule || !byId.get(item.step.id) || byId.get(item.step.id) !== item) continue;
        if (!knownAt(item.step, asOf)) continue;
        const life = lifecycleBounds(item.step, createdAt, deadline, asOf);
        if (!scheduledOn(item.schedule, date, life.start, life.end)) continue;
        if (hasLifecycle(item.step)) {
          if (compareCivil(date, life.start) < 0) continue;
          if (life.end && compareCivil(date, life.end) > 0) continue;
        }
        const dateText = formatCivil(date);
        const done = doneKeys.has(`${item.step.id}|${dateText}`);
        const finalizedMiss = !done && life.archived && !!life.end && sameCivil(date, life.end);
        occurrences.push({
          stepId: item.step.id,
          date: dateText,
          status: done ? 'DONE' : finalizedMiss ? 'MISSED' : statusFor(date, asOf),
          evidence: done ? 'self_report' : 'no_completion_row',
        });
      }
    }
  }

  const summary = {
    done: occurrences.filter(item => item.status === 'DONE').length,
    missed: occurrences.filter(item => item.status === 'MISSED').length,
    todo: occurrences.filter(item => item.status === 'TODO').length,
    future: occurrences.filter(item => item.status === 'FUTURE').length,
    total: occurrences.length,
  };

  const steps = classified
    .filter(item => byId.get(item.step.id) === item && knownAt(item.step, asOf))
    .map(item => toSnapshotStep(item, createdAt, deadline, asOf));
  const lifecyclePolicy = input.steps.some(hasLifecycle) ? 'immutable-step-archive-v1' as const : undefined;
  const ambiguousSteps = steps
    .filter(step => step.ambiguity)
    .map(step => ({ stepId: step.id, reason: step.ambiguity as string }))
    .sort((a, b) => a.stepId.localeCompare(b.stepId) || a.reason.localeCompare(b.reason));

  unscheduled.sort(compareRows);
  outside.sort(compareRows);

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    recurrencePolicy: RECURRENCE_POLICY_VERSION,
    recurrenceStartPolicy: RECURRENCE_START_POLICY,
    asOf: formatCivil(asOf),
    dateConvention: DATE_CONVENTION,
    weekdayIndex: WEEKDAY_INDEX,
    window: {
      from: inverted ? null : formatCivil(windowFrom),
      to: inverted ? null : formatCivil(windowTo),
      futureHorizonDays,
      pastHorizonDays,
      goalCreatedAt: formatCivil(createdAt),
      goalDeadline: deadline ? formatCivil(deadline) : null,
      horizonEnd: formatCivil(horizonEnd),
      truncatedPast: !inverted && compareCivil(createdAt, windowFrom) < 0,
      truncatedFuture: deadline == null || compareCivil(deadline, horizonEnd) > 0,
      rule: 'Inclusive civil dates from max(createdAt, asOf - pastHorizonDays) through min(deadline or horizon end, asOf + futureHorizonDays). Repeating dates outside createdAt..deadline are not scheduled. Scheduled dates outside this window are omitted and, when a completion exists, listed in completionsOutsideWindow.',
    },
    goal: {
      id: input.goal.id,
      title: input.goal.title,
      deadline: deadline ? formatCivil(deadline) : null,
      completed: input.goal.completed,
      failedAt: failedAt.date ? formatCivil(failedAt.date) : null,
      completionEvidence: 'stored_flag_only',
    },
    steps,
    occurrences,
    summary,
    unscheduledCompletions: unscheduled,
    completionsOutsideWindow: outside,
    ambiguousSteps,
    constraints: {
      goalDeadline: deadline ? formatCivil(deadline) : null,
      schedules: 'step_rows',
      workloadLimit: null,
      taskDurationMinutes: null,
      userPreferences: null,
      verifiedAchievement: null,
    },
    missing: [...MISSING_FIELDS],
    limitations: [...limitations].sort(),
    ...(lifecyclePolicy ? { lifecyclePolicy } : {}),
  };
}

function classifySteps(steps: ProgressSnapshotStep[]): ClassifiedStep[] {
  return [...steps]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(step => {
      const result = classifySchedule(step);
      return { step, ...result };
    });
}

function classifySchedule(step: ProgressSnapshotStep): {
  schedule: DefiniteSchedule | null;
  ambiguity: string | null;
  occurrenceStatus: StepOccurrenceStatus;
} {
  const repeat = normalizeRepeat(step.repeat);
  const due = step.dueAt == null || step.dueAt === '' ? null : parseCivil(step.dueAt);
  const dueWasSet = step.dueAt != null && step.dueAt !== '';

  if (dueWasSet && !due) {
    return { schedule: null, ambiguity: 'invalid_due_date', occurrenceStatus: 'ambiguous' };
  }
  if (repeat && repeat !== 'once' && due) {
    return { schedule: null, ambiguity: 'conflicting_due_and_repeat', occurrenceStatus: 'ambiguous' };
  }
  if (!repeat || repeat === 'once') {
    if (!due) {
      if (repeat === 'once') return { schedule: null, ambiguity: 'once_missing_due_date', occurrenceStatus: 'ambiguous' };
      return { schedule: null, ambiguity: null, occurrenceStatus: 'unscheduled' };
    }
    return { schedule: { kind: 'once', due }, ambiguity: null, occurrenceStatus: 'scheduled' };
  }
  if (repeat === 'daily') {
    return { schedule: { kind: 'daily' }, ambiguity: null, occurrenceStatus: 'scheduled' };
  }
  if (repeat === 'weekly') {
    if (!isWeekday(step.repeatDay)) {
      return { schedule: null, ambiguity: 'weekly_missing_weekday', occurrenceStatus: 'ambiguous' };
    }
    return { schedule: { kind: 'weekly', repeatDay: step.repeatDay }, ambiguity: null, occurrenceStatus: 'scheduled' };
  }
  if (repeat === 'monthly') {
    if (!isMonthDay(step.repeatDay)) {
      return { schedule: null, ambiguity: 'monthly_missing_day', occurrenceStatus: 'ambiguous' };
    }
    return { schedule: { kind: 'monthly', repeatDay: step.repeatDay }, ambiguity: null, occurrenceStatus: 'scheduled' };
  }
  if (repeat === 'custom') {
    const prepared = prepareCustomDates(step.customDates ?? []);
    if (!prepared.ok || prepared.dates.length === 0) {
      return { schedule: null, ambiguity: 'custom_dates_invalid', occurrenceStatus: 'ambiguous' };
    }
    return { schedule: { kind: 'custom', dates: prepared.dates }, ambiguity: null, occurrenceStatus: 'scheduled' };
  }
  if (repeat === 'yearly') {
    if (!isMonth(step.repeatMonth) || !isMonthDay(step.repeatDay)) {
      return { schedule: null, ambiguity: 'yearly_missing_month_or_day', occurrenceStatus: 'ambiguous' };
    }
    if (!isCalendarMonthDay(step.repeatMonth, step.repeatDay)) {
      return { schedule: null, ambiguity: 'yearly_impossible_date', occurrenceStatus: 'ambiguous' };
    }
    return {
      schedule: { kind: 'yearly', repeatMonth: step.repeatMonth, repeatDay: step.repeatDay },
      ambiguity: null,
      occurrenceStatus: 'scheduled',
    };
  }
  return { schedule: null, ambiguity: 'unknown_repeat', occurrenceStatus: 'ambiguous' };
}

function effectiveStart(step: ProgressSnapshotStep, goalCreated: Civil): Civil {
  if (!step.createdAt) return goalCreated;
  const created = parseCivil(step.createdAt);
  if (!created) return goalCreated;
  return compareCivil(created, goalCreated) > 0 ? created : goalCreated;
}

function hasLifecycle(step: ProgressSnapshotStep): boolean {
  return Boolean(step.effectiveFrom || step.effectiveUntil || step.archivedOn);
}

function knownAt(step: ProgressSnapshotStep, asOf: Civil): boolean {
  if (!step.createdAt) return true;
  const created = parseCivil(step.createdAt);
  if (!created) return true;
  return compareCivil(created, asOf) <= 0;
}

function lifecycleBounds(step: ProgressSnapshotStep, goalCreated: Civil, deadline: Civil | null, asOf: Civil): {
  start: Civil;
  end: Civil | null;
  archived: boolean;
} {
  let start = effectiveStart(step, goalCreated);
  const from = step.effectiveFrom ? parseCivil(step.effectiveFrom) : null;
  if (from && compareCivil(from, start) > 0) start = from;
  const archivedOn = step.archivedOn ? parseCivil(step.archivedOn) : null;
  const archived = !!archivedOn && compareCivil(archivedOn, asOf) <= 0;
  let end = deadline;
  if (archived) {
    const until = step.effectiveUntil ? parseCivil(step.effectiveUntil) : archivedOn;
    if (until) end = end ? minCivil(end, until) : until;
  }
  return { start, end, archived };
}

function scheduledOn(schedule: DefiniteSchedule, date: Civil, createdAt: Civil, deadline: Civil | null): boolean {
  if (schedule.kind === 'once') return sameCivil(schedule.due, date);
  if (schedule.kind === 'custom') {
    if (!schedule.dates.includes(formatCivil(date))) return false;
    if (compareCivil(date, createdAt) < 0) return false;
    if (deadline && compareCivil(date, deadline) > 0) return false;
    return true;
  }
  if (compareCivil(date, createdAt) < 0) return false;
  if (deadline && compareCivil(date, deadline) > 0) return false;
  if (schedule.kind === 'daily') return true;
  if (schedule.kind === 'weekly') return weekday(date) === schedule.repeatDay;
  if (schedule.kind === 'monthly') return date.d === clampedMonthDay(date.y, date.m, schedule.repeatDay);
  return date.m === schedule.repeatMonth && date.d === clampedMonthDay(date.y, date.m, schedule.repeatDay);
}

function toSnapshotStep(item: ClassifiedStep, goalCreated: Civil, deadline: Civil | null, asOf: Civil): SnapshotStep {
  const step = {
    id: item.step.id,
    order: item.step.order,
    text: item.step.text,
    description: item.step.description,
    schedule: toPublicSchedule(item),
    occurrenceStatus: item.occurrenceStatus,
    ambiguity: item.ambiguity,
  };
  if (!hasLifecycle(item.step)) return step;
  return { ...step, lifecycle: lifecycleBounds(item.step, goalCreated, deadline, asOf).archived ? 'archived' as const : 'active' as const };
}

function toPublicSchedule(item: ClassifiedStep): SnapshotSchedule {
  const schedule = item.schedule;
  if (!schedule) return { type: 'none' };
  if (schedule.kind === 'once') return { type: 'once', due: formatCivil(schedule.due) };
  if (schedule.kind === 'daily') return { type: 'repeat', repeat: 'daily' };
  if (schedule.kind === 'weekly') return { type: 'repeat', repeat: 'weekly', repeatDay: schedule.repeatDay };
  if (schedule.kind === 'monthly') return { type: 'repeat', repeat: 'monthly', repeatDay: schedule.repeatDay };
  if (schedule.kind === 'custom') return { type: 'custom', dates: schedule.dates };
  return { type: 'repeat', repeat: 'yearly', repeatMonth: schedule.repeatMonth, repeatDay: schedule.repeatDay };
}

function statusFor(date: Civil, asOf: Civil): OccurrenceStatus {
  const order = compareCivil(date, asOf);
  if (order < 0) return 'MISSED';
  if (order > 0) return 'FUTURE';
  return 'TODO';
}

function normalizeRepeat(repeat: string | null | undefined): string | null {
  if (repeat == null) return null;
  const value = repeat.trim().toLowerCase();
  return value || null;
}

function isWeekday(value: number | null): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

function isMonthDay(value: number | null): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31;
}

function isMonth(value: number | null): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12;
}

function requireHorizon(value: number | undefined, name: string): number {
  const resolved = value ?? DEFAULT_HORIZON_DAYS;
  if (!Number.isInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be an integer >= 0`);
  }
  return resolved;
}

function requireCivil(value: string, name: string): Civil {
  const parsed = parseCivil(value);
  if (!parsed) throw new RangeError(`${name} must be a real civil date YYYY-MM-DD`);
  return parsed;
}

function parseOptionalCivil(value: string | null): { date: Civil | null; invalid: boolean } {
  if (value == null || value === '') return { date: null, invalid: false };
  const parsed = parseCivil(value);
  return parsed ? { date: parsed, invalid: false } : { date: null, invalid: true };
}

function parseCivil(value: string): Civil | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatCivil(date: Civil): string {
  return `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
}

function compareCivil(a: Civil, b: Civil): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

function sameCivil(a: Civil, b: Civil): boolean {
  return compareCivil(a, b) === 0;
}

function minCivil(a: Civil, b: Civil): Civil {
  return compareCivil(a, b) <= 0 ? a : b;
}

function maxCivil(a: Civil, b: Civil): Civil {
  return compareCivil(a, b) >= 0 ? a : b;
}

function addDays(date: Civil, days: number): Civil {
  const utc = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() };
}

function weekday(date: Civil): number {
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
}

function eachDate(from: Civil, to: Civil): Civil[] {
  const dates: Civil[] = [];
  for (let cursor = from; compareCivil(cursor, to) <= 0; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function compareRows(a: { stepId: string; date: string }, b: { stepId: string; date: string }): number {
  return a.date.localeCompare(b.date) || a.stepId.localeCompare(b.stepId);
}
