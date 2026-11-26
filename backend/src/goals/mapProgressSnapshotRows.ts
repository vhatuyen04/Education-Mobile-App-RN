/**
 * Maps stored Goal, GoalStep, and GoalStepCompletion values into the pure
 * progress-snapshot input.
 *
 * PostgreSQL stores these columns as TIMESTAMP(3) without a time zone.
 * A value at UTC midnight is an explicit civil date (utc-midnight-civil-date-v1)
 * and is read from its UTC year-month-day. Every other value is legacy: the
 * civil date is the calendar day of that instant in the explicit timeZone.
 * Legacy rows are not rewritten. The original write-time zone is not stored,
 * so the wrong zone can still shift a legacy date by one day.
 * Step and goal creation instants always use that zone. They are not treated
 * as civil-date encodings.
 */

import type { BuildProgressSnapshotInput } from './progressSnapshot.js';
import { storedInstantCivilDate } from './recurrenceSchedule.js';

export const STORED_TIMESTAMP_LIMITATION =
  'TIMESTAMP(3) has no stored time zone. UTC midnight is an explicit civil date. Every other instant uses the explicit timeZone argument. The original write-time zone is not in the row, so the wrong zone can shift a legacy date by one day.';

export type StoredGoalRow = {
  id: string;
  title: string;
  createdAt: Date;
  dueAt: Date | null;
  completed: boolean;
  failedAt: Date | null;
};

export type StoredStepRow = {
  id: string;
  order: number;
  text: string;
  description: string | null;
  dueAt: Date | null;
  repeat: string | null;
  repeatDay: number | null;
  repeatMonth: number | null;
  repeatDays?: number[] | null;
  customDates?: string[] | null;
  createdAt?: Date | null;
  archivedAt?: Date | null;
  effectiveFrom?: Date | null;
  effectiveUntil?: Date | null;
};

export type StoredCompletionRow = {
  stepId: string;
  date: Date;
};

export type MappedSnapshotInput = Omit<BuildProgressSnapshotInput, 'asOf' | 'futureHorizonDays' | 'pastHorizonDays'>;

export function mapStoredGoalToSnapshotInput(input: {
  goal: StoredGoalRow;
  steps: StoredStepRow[];
  completions: StoredCompletionRow[];
  timeZone: string;
}): MappedSnapshotInput {
  const timeZone = assertTimeZone(input.timeZone);
  return {
    goal: {
      id: input.goal.id,
      title: input.goal.title,
      createdAt: civilDateInTimeZone(input.goal.createdAt, timeZone),
      deadline: input.goal.dueAt ? storedInstantCivilDate(input.goal.dueAt, timeZone) : null,
      completed: input.goal.completed,
      failedAt: input.goal.failedAt ? civilDateInTimeZone(input.goal.failedAt, timeZone) : null,
    },
    steps: input.steps.map(step => ({
      id: step.id,
      order: step.order,
      text: step.text,
      description: step.description,
      dueAt: step.dueAt ? storedInstantCivilDate(step.dueAt, timeZone) : null,
      repeat: step.repeat,
      repeatDay: step.repeatDay,
      repeatMonth: step.repeatMonth,
      ...(step.repeatDays && step.repeatDays.length ? { repeatDays: [...step.repeatDays] } : {}),
      ...(step.customDates && step.customDates.length ? { customDates: [...step.customDates] } : {}),
      createdAt: step.createdAt ? civilDateInTimeZone(step.createdAt, timeZone) : null,
      ...(step.effectiveFrom ? { effectiveFrom: storedInstantCivilDate(step.effectiveFrom, timeZone) } : {}),
      ...(step.effectiveUntil ? { effectiveUntil: storedInstantCivilDate(step.effectiveUntil, timeZone) } : {}),
      ...(step.archivedAt ? { archivedOn: civilDateInTimeZone(step.archivedAt, timeZone) } : {}),
    })),
    completions: input.completions.map(completion => ({
      stepId: completion.stepId,
      date: storedInstantCivilDate(completion.date, timeZone),
    })),
  };
}

export function civilDateInTimeZone(instant: Date, timeZone: string): string {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new RangeError('instant must be a valid Date');
  }
  const zone = assertTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  if (!year || !month || !day) throw new RangeError('could not format a civil date');
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function assertTimeZone(timeZone: string): string {
  const zone = timeZone.trim();
  if (!zone) throw new RangeError('timeZone is required');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0));
  } catch {
    throw new RangeError(`timeZone is not a valid IANA zone: ${zone}`);
  }
  return zone;
}
