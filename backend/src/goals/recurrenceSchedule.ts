/**
 * Canonical GoalStep recurrence.
 *
 * The frontend sends text such as daily, weekly:Mon, monthly:31,
 * yearly:02-29, and once:YYYY-MM-DD. The API stores repeat, repeatDay
 * (0=Sunday … 6=Saturday), repeatMonth, and dueAt. A missing weekday,
 * month, or day stays missing. It is not filled in with a real date.
 *
 * Policy version clamp-last-valid-day-v1:
 * - daily: every calendar day in the goal range
 * - weekly: the stored weekday only
 * - monthly: the requested day, clamped to the last day of a shorter month
 * - yearly: the requested month and day; 29 February clamps to 28 February
 *   in a non-leap year
 * - once: the stored local calendar date
 * - unscheduled, unknown, or incomplete: no occurrences
 *
 * Daily counts walk calendar days. They do not divide millisecond spans,
 * so a daylight-saving transition does not drop or duplicate a day.
 * Open-ended goals still use a 100-occurrence progress horizon. A deadline
 * that contains zero matching days stays at zero.
 */

export const RECURRENCE_POLICY_VERSION = 'clamp-last-valid-day-v1' as const;
export const OPEN_ENDED_REPEAT_HORIZON = 100;

export type StoredSchedule = {
  dueAt?: Date | string | null;
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
};

const MONTH_MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const SUPPORTED_REPEATS = new Set(['daily', 'weekly', 'monthly', 'yearly', 'once']);

export function normalizeRepeat(repeat: string | null | undefined): string | null {
  if (!repeat) return null;
  const value = repeat.trim().toLowerCase();
  return value || null;
}

export function isWeekdayIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

export function isMonthDayIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31;
}

/** A yearly month/day that exists in at least one year. 29 February is allowed. */
export function isCalendarMonthDay(month: unknown, day: unknown): boolean {
  if (typeof month !== 'number' || typeof day !== 'number') return false;
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false;
  return day <= MONTH_MAX_DAY[month - 1];
}

export function daysInCivilMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Last valid day for a monthly or yearly request. Does not invent a day when the request is missing. */
export function clampedMonthDay(year: number, month: number, requestedDay: number): number {
  return Math.min(requestedDay, daysInCivilMonth(year, month));
}

export function isDeterminateRepeat(step: StoredSchedule): boolean {
  const repeat = normalizeRepeat(step.repeat);
  if (repeat === 'daily') return true;
  if (repeat === 'weekly') return isWeekdayIndex(step.repeatDay);
  if (repeat === 'monthly') return isMonthDayIndex(step.repeatDay);
  if (repeat === 'yearly') return isCalendarMonthDay(step.repeatMonth, step.repeatDay);
  return false;
}

export function scheduleWriteError(step: StoredSchedule): string | null {
  const repeat = normalizeRepeat(step.repeat);
  const hasDue = step.dueAt != null && step.dueAt !== '';
  if (hasDue && repeat && repeat !== 'once') return 'A step cannot have both a due date and a repeat';
  if (repeat && !SUPPORTED_REPEATS.has(repeat)) return 'Use daily, weekly, monthly, yearly, or once';
  if (repeat === 'once' && !hasDue) return 'A one-time step needs a due date';
  if (repeat === 'weekly' && !isWeekdayIndex(step.repeatDay)) return 'Weekly steps need a weekday from Sun through Sat';
  if (repeat === 'monthly' && !isMonthDayIndex(step.repeatDay)) return 'Monthly steps need a day from 1 through 31';
  if (repeat === 'yearly' && !isCalendarMonthDay(step.repeatMonth, step.repeatDay)) return 'Yearly steps need a real month and day';
  return null;
}

/**
 * Expected progress occurrences.
 * A deadline-bounded goal uses the real count, including zero.
 * A goal with no deadline keeps the 100-occurrence horizon.
 */
export function expectedRepeatOccurrences(step: StoredSchedule, goalStart: Date, goalDue: Date | null): number {
  if (!isDeterminateRepeat(step)) return 0;
  if (!goalDue) return OPEN_ENDED_REPEAT_HORIZON;
  return countRepeatOccurrencesBetween(step, goalStart, goalDue);
}

export function isStepScheduledOnDay(step: StoredSchedule, now: Date): boolean {
  const todayStart = startOfLocalDay(now);
  const todayEnd = endOfLocalDay(now);
  const repeat = normalizeRepeat(step.repeat);

  if (!repeat || repeat === 'once') {
    if (!step.dueAt) return false;
    const due = new Date(step.dueAt);
    return due.getTime() >= todayStart.getTime() && due.getTime() <= todayEnd.getTime();
  }

  if (repeat === 'daily') return true;

  if (repeat === 'weekly') {
    if (!isWeekdayIndex(step.repeatDay)) return false;
    return now.getDay() === step.repeatDay;
  }

  if (repeat === 'monthly') {
    if (!isMonthDayIndex(step.repeatDay)) return false;
    return now.getDate() === clampedMonthDay(now.getFullYear(), now.getMonth() + 1, step.repeatDay);
  }

  if (repeat === 'yearly') {
    if (!isCalendarMonthDay(step.repeatMonth, step.repeatDay)) return false;
    const month = step.repeatMonth as number;
    if (now.getMonth() + 1 !== month) return false;
    return now.getDate() === clampedMonthDay(now.getFullYear(), month, step.repeatDay as number);
  }

  return false;
}

export function countRepeatOccurrencesBetween(step: StoredSchedule, fromDay: Date, toDay: Date): number {
  const repeat = normalizeRepeat(step.repeat);
  if (!repeat) return 0;

  const from = startOfLocalDay(fromDay);
  const to = startOfLocalDay(toDay);
  if (to.getTime() < from.getTime()) return 0;

  if (repeat === 'daily') {
    let count = 0;
    const cur = new Date(from);
    while (cur.getTime() <= to.getTime()) {
      count += 1;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  if (repeat === 'weekly') {
    if (!isWeekdayIndex(step.repeatDay)) return 0;
    let count = 0;
    const cur = new Date(from);
    while (cur.getTime() <= to.getTime()) {
      if (cur.getDay() === step.repeatDay) count += 1;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  if (repeat === 'monthly') {
    if (!isMonthDayIndex(step.repeatDay)) return 0;
    let count = 0;
    let year = from.getFullYear();
    let month = from.getMonth();
    for (let guard = 0; guard < 2400; guard += 1) {
      const occ = new Date(year, month, clampedMonthDay(year, month + 1, step.repeatDay));
      if (occ.getTime() > to.getTime()) break;
      if (occ.getTime() >= from.getTime()) count += 1;
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
    return count;
  }

  if (repeat === 'yearly') {
    if (!isCalendarMonthDay(step.repeatMonth, step.repeatDay)) return 0;
    let count = 0;
    const month = step.repeatMonth as number;
    const day = step.repeatDay as number;
    for (let year = from.getFullYear(); year <= to.getFullYear(); year += 1) {
      const occ = new Date(year, month - 1, clampedMonthDay(year, month, day));
      if (occ.getTime() >= from.getTime() && occ.getTime() <= to.getTime()) count += 1;
    }
    return count;
  }

  return 0;
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
