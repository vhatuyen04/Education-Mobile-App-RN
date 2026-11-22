/**
 * Maps stored Goal, GoalStep, and GoalStepCompletion values into the pure
 * progress-snapshot input.
 *
 * PostgreSQL stores these columns as TIMESTAMP(3) without a time zone. Prisma
 * returns a JavaScript Date for the clock time that was written. SmartGoal
 * writes a completion with the server process's local midnight, and that zone
 * is not stored on the row. This mapper formats each instant in the IANA
 * timeZone argument. It does not read the host timezone, the system clock, or
 * the database.
 *
 * If timeZone is not the zone that was local at insert time, the civil date
 * can move by one day. That ambiguity cannot be repaired from the stored value.
 */

import type { BuildProgressSnapshotInput } from './progressSnapshot.js';

export const STORED_TIMESTAMP_LIMITATION =
  'TIMESTAMP(3) has no stored time zone. Civil dates are the calendar date of each instant in the explicit timeZone argument. The original write-time zone is not in the row, so the wrong zone can shift a date by one day.';

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
      deadline: input.goal.dueAt ? civilDateInTimeZone(input.goal.dueAt, timeZone) : null,
      completed: input.goal.completed,
      failedAt: input.goal.failedAt ? civilDateInTimeZone(input.goal.failedAt, timeZone) : null,
    },
    steps: input.steps.map(step => ({
      id: step.id,
      order: step.order,
      text: step.text,
      description: step.description,
      dueAt: step.dueAt ? civilDateInTimeZone(step.dueAt, timeZone) : null,
      repeat: step.repeat,
      repeatDay: step.repeatDay,
      repeatMonth: step.repeatMonth,
    })),
    completions: input.completions.map(completion => ({
      stepId: completion.stepId,
      date: civilDateInTimeZone(completion.date, timeZone),
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
