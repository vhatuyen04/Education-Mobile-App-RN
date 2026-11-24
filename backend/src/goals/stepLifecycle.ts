/**
 * Immutable step lifecycle.
 *
 * A step's title, description, schedule, due date, and duration stay as saved.
 * Delete and replace archive the step. They do not remove its completions.
 * A replacement starts on the same civil date. The archived step keeps today's
 * DONE completion, and an unfinished scheduled day stays MISSED. The new step
 * has its own occurrence today because it has a different id. Progress counts
 * both when those dates fall inside the goal deadline.
 *
 * Edited schedules are not reconstructed. Legacy rows have no archive fields
 * and keep the later-of-goal-and-step-created-at-v1 window.
 * A completion toggle may change only today's scheduled occurrence on an
 * active step. Past and future days are read-only. The server clock and the
 * authoritative scheduling zone choose that day. An archived step rejects
 * every toggle.
 */

import {
  hasScheduleConflict,
  instantCivilDate,
  prepareCustomDates,
  isStepScheduledOnCivilDay,
  stepProgressBounds,
  storedInstantCivilDate,
  tryTimeZone,
  utcCivilDate,
  utcMidnightFromCivil,
  type StoredSchedule,
} from './recurrenceSchedule.js';

export { stepProgressBounds };

export const STEP_LIFECYCLE_POLICY = 'immutable-step-archive-v1' as const;

export type OccurrenceState = 'DONE' | 'MISSED' | 'TODO' | 'FUTURE';

export type StepDefinition = {
  text?: string | null;
  description?: string | null;
  dueAt?: Date | string | null;
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
  durationMinutes?: number | null;
};

export type LifecycleStep = StoredSchedule & {
  id?: string;
  createdAt?: Date | string | null;
  archivedAt?: Date | string | null;
  effectiveFrom?: Date | string | null;
  effectiveUntil?: Date | string | null;
};

const IMMUTABLE_FIELDS = ['text', 'description', 'repeat', 'repeatDay', 'repeatMonth', 'durationMinutes'] as const;

export function readDurationMinutes(value: unknown): { ok: true; minutes: number | null } | { ok: false; error: string } {
  if (value == null || value === '') return { ok: true, minutes: null };
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return { ok: false, error: 'Duration must be a positive number of minutes' };
  }
  return { ok: true, minutes: value };
}

export function immutableFieldChange(existing: StepDefinition, patch: StepDefinition): string | null {
  for (const field of IMMUTABLE_FIELDS) {
    if (patch[field] === undefined) continue;
    if (normalizeField(existing[field]) !== normalizeField(patch[field])) return field;
  }
  if (patch.dueAt !== undefined && instantMillis(existing.dueAt) !== instantMillis(patch.dueAt)) return 'dueAt';
  return null;
}

export function addCivilDays(civil: string, days: number): string | null {
  const utc = utcMidnightFromCivil(civil);
  if (!utc || !Number.isInteger(days)) return null;
  utc.setUTCDate(utc.getUTCDate() + days);
  return utcCivilDate(utc);
}

export function archiveDecision(args: {
  archivedAt?: Date | string | null;
  effectiveUntil?: Date | string | null;
  todayCivil: string;
  scheduledToday: boolean;
  now: Date;
}): { changed: boolean; archivedAt: Date; effectiveUntil: string } {
  if (args.archivedAt) {
    const storedUntil = args.effectiveUntil
      ? storedInstantCivilDate(new Date(args.effectiveUntil), null)
      : addCivilDays(args.todayCivil, -1);
    return {
      changed: false,
      archivedAt: new Date(args.archivedAt),
      effectiveUntil: storedUntil ?? args.todayCivil,
    };
  }
  return {
    changed: true,
    archivedAt: args.now,
    effectiveUntil: args.scheduledToday ? args.todayCivil : (addCivilDays(args.todayCivil, -1) ?? args.todayCivil),
  };
}

export function scheduledOnCivilDate(args: {
  step: LifecycleStep;
  civil: string;
  goalCreatedAt: Date;
  goalDueAt?: Date | string | null;
  legacyTimeZone?: string | null;
  ignoreArchive?: boolean;
}): boolean {
  if (!utcMidnightFromCivil(args.civil) || hasScheduleConflict(args.step)) return false;
  const bounds = stepProgressBounds({
    ...args,
    step: args.ignoreArchive ? { ...args.step, archivedAt: null, effectiveUntil: null } : args.step,
  });
  if (!bounds) return false;
  if (args.civil < bounds.start) return false;
  if (bounds.end && args.civil > bounds.end) return false;
  return isStepScheduledOnCivilDay(args.step, args.civil, args.legacyTimeZone);
}

export function completionAllowed(step: { archivedAt?: Date | string | null }): boolean {
  return !step.archivedAt;
}

/**
 * Past and future occurrences are read-only. Only an active step's occurrence
 * on the server's current civil day can be marked DONE or undone.
 * The requested instant identifies the day. It does not choose which day is current.
 */
export function completionToggleDecision(args: {
  now: Date;
  authoritativeTimeZone?: string | null;
  requestedDate: Date | string;
  step: LifecycleStep;
  goalCreatedAt: Date;
  goalDueAt?: Date | string | null;
}): { ok: true; civilToday: string; storedDate: Date } | { ok: false; status: 400 | 409; error: string } {
  const zone = tryTimeZone(args.authoritativeTimeZone);
  const requested = new Date(args.requestedDate);
  if (Number.isNaN(requested.getTime())) return { ok: false, status: 400, error: 'Invalid payload' };
  if (!completionAllowed(args.step)) return { ok: false, status: 409, error: 'Archived steps cannot be changed' };
  const civilToday = instantCivilDate(args.now, zone);
  const requestedCivil = storedInstantCivilDate(requested, zone);
  if (requestedCivil < civilToday) return { ok: false, status: 409, error: 'Past occurrences are read-only' };
  if (requestedCivil > civilToday) return { ok: false, status: 409, error: 'Future occurrences are read-only' };
  const scheduled = scheduledOnCivilDate({
    step: args.step,
    civil: civilToday,
    goalCreatedAt: args.goalCreatedAt,
    goalDueAt: args.goalDueAt,
    legacyTimeZone: zone,
  });
  if (!scheduled) return { ok: false, status: 409, error: 'This step is not scheduled today' };
  const storedDate = utcMidnightFromCivil(civilToday);
  if (!storedDate) return { ok: false, status: 400, error: 'Invalid payload' };
  return { ok: true, civilToday, storedDate };
}

export type ReplacementPlan = {
  previous: { archivedAt: Date; effectiveUntil: string };
  next: {
    effectiveFrom: string;
    replacesStepId: string;
    text: string;
    description: string | null;
    dueAt: string | null;
    repeat: string | null;
    repeatDay: number | null;
    repeatMonth: number | null;
    customDates: string[];
    durationMinutes: number | null;
    order: number;
  };
};

export function planReplacement(args: {
  stepId: string;
  archivedAt?: Date | string | null;
  todayCivil: string;
  scheduledToday: boolean;
  now: Date;
  text: string;
  description?: string | null;
  dueAt?: string | null;
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
  customDates?: string[] | null;
  durationMinutes?: number | null;
  order?: number;
}): ReplacementPlan | { error: string } {
  if (args.archivedAt) return { error: 'Archived steps cannot be replaced' };
  const duration = readDurationMinutes(args.durationMinutes);
  if (!duration.ok) return duration;
  const text = args.text.trim();
  if (!text) return { error: 'Invalid payload' };
  const starts = args.todayCivil;
  if (!utcMidnightFromCivil(starts)) return { error: 'Invalid payload' };
  const decision = archiveDecision(args);
  const preparedDates = prepareCustomDates(args.customDates);
  const customDates = String(args.repeat ?? '').trim().toLowerCase() === 'custom' && preparedDates.ok ? preparedDates.dates : [];
  return {
    previous: { archivedAt: decision.archivedAt, effectiveUntil: decision.effectiveUntil },
    next: {
      effectiveFrom: starts,
      replacesStepId: args.stepId,
      text,
      description: args.description?.trim() ? args.description.trim() : null,
      dueAt: args.dueAt ?? null,
      repeat: args.repeat ? String(args.repeat) : null,
      repeatDay: args.repeatDay ?? null,
      repeatMonth: args.repeatMonth ?? null,
      customDates,
      durationMinutes: duration.minutes,
      order: args.order ?? 0,
    },
  };
}

export async function commitReplacement<T>(
  store: {
    create: (next: ReplacementPlan['next']) => Promise<T>;
    archive: (previous: ReplacementPlan['previous']) => Promise<void>;
  },
  plan: ReplacementPlan
): Promise<T> {
  const created = await store.create(plan.next);
  await store.archive(plan.previous);
  return created;
}

export function stepHistory(args: {
  step: LifecycleStep;
  goalCreatedAt: Date;
  goalDueAt?: Date | string | null;
  completions?: Array<{ date: Date | string }>;
  now?: Date;
  legacyTimeZone?: string | null;
  pastDays?: number;
  futureDays?: number;
}): {
  today: string;
  scheduledToday: boolean;
  doneToday: boolean;
  replacementStartsOn: string;
  archiveEffectiveUntil: string;
  effectiveStart: string;
  effectiveEnd: string | null;
  occurrences: Array<{ date: string; status: OccurrenceState }>;
  completionDates: string[];
} {
  const zone = tryTimeZone(args.legacyTimeZone);
  const now = args.now ?? new Date();
  const today = instantCivilDate(now, zone);
  const bounds = stepProgressBounds({ ...args, legacyTimeZone: zone });
  const activeBounds = stepProgressBounds({
    ...args,
    legacyTimeZone: zone,
    step: { ...args.step, archivedAt: null, effectiveUntil: null },
  });
  const scheduledToday = !args.step.archivedAt && !!activeBounds && scheduledOnCivilDate({
    step: args.step,
    civil: today,
    goalCreatedAt: args.goalCreatedAt,
    goalDueAt: args.goalDueAt,
    legacyTimeZone: zone,
    ignoreArchive: true,
  });
  const decision = archiveDecision({
    archivedAt: args.step.archivedAt,
    effectiveUntil: args.step.effectiveUntil,
    todayCivil: today,
    scheduledToday,
    now,
  });
  const done = new Set(
    (args.completions ?? []).map(row => storedInstantCivilDate(new Date(row.date), zone))
  );
  const past = addCivilDays(today, -(args.pastDays ?? 60)) ?? today;
  const future = addCivilDays(today, args.futureDays ?? 14) ?? today;
  const start = bounds?.start ?? activeBounds?.start ?? today;
  const lifeEnd = args.step.archivedAt ? decision.effectiveUntil : (bounds?.end ?? future);
  let from = start > past ? start : past;
  let to = lifeEnd && lifeEnd < future ? lifeEnd : future;
  if (bounds?.end && bounds.end < to) to = bounds.end;
  const occurrences: Array<{ date: string; status: OccurrenceState }> = [];
  if (from <= to) {
    for (let cursor = from; cursor && cursor <= to; cursor = addCivilDays(cursor, 1) ?? '') {
      if (!cursor) break;
      if (!isStepScheduledOnCivilDay(args.step, cursor, zone)) continue;
      if (cursor < start) continue;
      const marked = done.has(cursor);
      let status: OccurrenceState;
      if (marked) status = 'DONE';
      else if (cursor < today) status = 'MISSED';
      else if (args.step.archivedAt) status = 'MISSED';
      else if (cursor > today) status = 'FUTURE';
      else status = 'TODO';
      occurrences.push({ date: cursor, status });
    }
  }
  return {
    today,
    scheduledToday,
    doneToday: done.has(today),
    replacementStartsOn: today,
    archiveEffectiveUntil: decision.effectiveUntil,
    effectiveStart: start,
    effectiveEnd: args.step.archivedAt ? decision.effectiveUntil : (bounds?.end ?? null),
    occurrences,
    completionDates: [...done].filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort(),
  };
}

function normalizeField(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value);
}

function instantMillis(value: Date | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}
