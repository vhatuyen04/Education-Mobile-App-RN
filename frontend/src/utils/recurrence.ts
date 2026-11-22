/**
 * Client recurrence for reminders and the AI Planner.
 * Matches backend/src/goals/recurrenceSchedule.ts policy clamp-last-valid-day-v1.
 *
 * Daily is every calendar day. Weekly is the stored weekday.
 * Monthly and yearly clamp to the last valid day of a short month.
 * February 29 clamps to February 28 in a non-leap year.
 * Missing weekday, month, or day fields produce no occurrence.
 * Dates are built from year, month, and a clamped day, so day 31 cannot roll into the next month.
 */

export type RepeatFields = {
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
};

const MONTH_MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function normalizeRepeat(repeat: string | null | undefined): string | null {
  if (!repeat) return null;
  const value = repeat.trim().toLowerCase();
  return value || null;
}

function isWeekday(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

function isMonthDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31;
}

function isCalendarMonthDay(month: unknown, day: unknown): boolean {
  if (typeof month !== 'number' || typeof day !== 'number') return false;
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false;
  return day <= MONTH_MAX_DAY[month - 1];
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfCivilDay(year: number, monthIndex0: number, day: number): Date {
  return new Date(year, monthIndex0, day, 23, 59, 59, 999);
}

function addCalendarDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function occurrenceIsOnOrBeforeGoalDue(occurrence: Date, goalDueAt?: Date | string | null): boolean {
  if (goalDueAt == null || goalDueAt === '') return true;
  const due = new Date(goalDueAt);
  if (Number.isNaN(due.getTime())) return true;
  return startOfLocalDay(occurrence).getTime() <= startOfLocalDay(due).getTime();
}

function afterGoalDue(occurrence: Date, goalDueAt?: Date | string | null): boolean {
  return !occurrenceIsOnOrBeforeGoalDue(occurrence, goalDueAt);
}

/**
 * Next reminder instant at the end of the occurrence day.
 * Weekly can fire later today. Monthly days 29–31 use the clamped day.
 * Yearly February 29 uses February 28 when that year is not a leap year.
 * A result after the goal deadline is omitted.
 */
export function nextReminderOccurrence(
  params: RepeatFields & { goalDueAt?: Date | string | null; now?: Date }
): Date | null {
  const repeat = normalizeRepeat(params.repeat);
  const now = params.now ? new Date(params.now) : new Date();
  if (Number.isNaN(now.getTime()) || !repeat) return null;
  const goalDueAt = params.goalDueAt;

  if (repeat === 'daily') {
    let cand = endOfCivilDay(now.getFullYear(), now.getMonth(), now.getDate());
    if (cand.getTime() <= now.getTime()) {
      const next = addCalendarDays(now, 1);
      cand = endOfCivilDay(next.getFullYear(), next.getMonth(), next.getDate());
    }
    return afterGoalDue(cand, goalDueAt) ? null : cand;
  }

  if (repeat === 'weekly') {
    if (!isWeekday(params.repeatDay)) return null;
    const delta = (params.repeatDay - now.getDay() + 7) % 7;
    let day = addCalendarDays(now, delta);
    let cand = endOfCivilDay(day.getFullYear(), day.getMonth(), day.getDate());
    if (cand.getTime() <= now.getTime()) {
      day = addCalendarDays(day, 7);
      cand = endOfCivilDay(day.getFullYear(), day.getMonth(), day.getDate());
    }
    return afterGoalDue(cand, goalDueAt) ? null : cand;
  }

  if (repeat === 'monthly') {
    if (!isMonthDay(params.repeatDay)) return null;
    let year = now.getFullYear();
    let month = now.getMonth();
    for (let guard = 0; guard < 36; guard += 1) {
      const cand = endOfCivilDay(year, month, Math.min(params.repeatDay, daysInMonth(year, month)));
      if (afterGoalDue(cand, goalDueAt)) return null;
      if (cand.getTime() > now.getTime()) return cand;
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
    return null;
  }

  if (repeat === 'yearly') {
    if (!isCalendarMonthDay(params.repeatMonth, params.repeatDay)) return null;
    const month = params.repeatMonth as number;
    const day = params.repeatDay as number;
    let year = now.getFullYear();
    for (let guard = 0; guard < 8; guard += 1) {
      const cand = endOfCivilDay(year, month - 1, Math.min(day, daysInMonth(year, month - 1)));
      if (afterGoalDue(cand, goalDueAt)) return null;
      if (cand.getTime() > now.getTime()) return cand;
      year += 1;
    }
    return null;
  }

  return null;
}

export function countRepeatOccurrencesUntilDeadline(params: {
  repeat: string;
  repeatDay?: number | null;
  repeatMonth?: number | null;
  start: Date;
  deadline: Date;
}): { count: number; lastOccurrence: Date | null } {
  const repeat = normalizeRepeat(params.repeat);
  const start0 = startOfLocalDay(params.start);
  const end0 = startOfLocalDay(params.deadline);
  if (!repeat || end0.getTime() < start0.getTime()) return { count: 0, lastOccurrence: null };

  if (repeat === 'daily') {
    let count = 0;
    let last: Date | null = null;
    const cur = new Date(start0);
    while (cur.getTime() <= end0.getTime()) {
      count += 1;
      last = new Date(cur);
      cur.setDate(cur.getDate() + 1);
    }
    return { count, lastOccurrence: last };
  }

  if (repeat === 'weekly') {
    if (!isWeekday(params.repeatDay)) return { count: 0, lastOccurrence: null };
    const delta = (params.repeatDay - start0.getDay() + 7) % 7;
    const cur = addCalendarDays(start0, delta);
    cur.setHours(0, 0, 0, 0);
    if (cur.getTime() > end0.getTime()) return { count: 0, lastOccurrence: null };
    let count = 0;
    let last: Date | null = null;
    while (cur.getTime() <= end0.getTime()) {
      count += 1;
      last = new Date(cur);
      cur.setDate(cur.getDate() + 7);
    }
    return { count, lastOccurrence: last };
  }

  if (repeat === 'monthly') {
    if (!isMonthDay(params.repeatDay)) return { count: 0, lastOccurrence: null };
    let year = start0.getFullYear();
    let month = start0.getMonth();
    let count = 0;
    let last: Date | null = null;
    for (let guard = 0; guard < 600; guard += 1) {
      const occ = new Date(year, month, Math.min(params.repeatDay, daysInMonth(year, month)));
      occ.setHours(0, 0, 0, 0);
      if (occ.getTime() > end0.getTime()) break;
      if (occ.getTime() >= start0.getTime()) {
        count += 1;
        last = occ;
      }
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
    return { count, lastOccurrence: last };
  }

  if (repeat === 'yearly') {
    if (!isCalendarMonthDay(params.repeatMonth, params.repeatDay)) return { count: 0, lastOccurrence: null };
    const month = params.repeatMonth as number;
    const day = params.repeatDay as number;
    let count = 0;
    let last: Date | null = null;
    for (let year = start0.getFullYear(); year <= end0.getFullYear() + 1; year += 1) {
      const occ = new Date(year, month - 1, Math.min(day, daysInMonth(year, month - 1)));
      occ.setHours(0, 0, 0, 0);
      if (occ.getTime() > end0.getTime()) break;
      if (occ.getTime() >= start0.getTime()) {
        count += 1;
        last = occ;
      }
    }
    return { count, lastOccurrence: last };
  }

  return { count: 0, lastOccurrence: null };
}
