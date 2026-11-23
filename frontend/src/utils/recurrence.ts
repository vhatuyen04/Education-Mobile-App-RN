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

export function isUtcMidnightInstant(value: Date): boolean {
  return value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0;
}

export function deadlineRetryMessage(): string {
  return `Pick a real deadline from today onward, such as ${deviceCivilDate()}, and try again.`;
}

export function realCivilDate(value: string): string | null {
  const raw = value.trim();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw);
  if (!ymd && !dmy) return null;
  const year = ymd ? Number(ymd[1]) : Number(dmy?.[3]);
  const month = ymd ? Number(ymd[2]) : Number(dmy?.[2]);
  const day = ymd ? Number(ymd[3]) : Number(dmy?.[1]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month - 1)) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Empty is allowed. A typed deadline must be a real civil date from today onward. */
export function deadlineError(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const civil = realCivilDate(raw);
  if (!civil || civil < deviceCivilDate()) return deadlineRetryMessage();
  return null;
}

export function utcMidnightIsoFromCivilText(value: string): string | null {
  const civil = realCivilDate(value);
  if (!civil) return null;
  const [year, month, day] = civil.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

export function deviceCivilDate(value: Date = new Date()): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

export function utcMidnightIsoFromLocalCivil(value: Date = new Date()): string {
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())).toISOString();
}

export function localReminderInstant(due: Date): Date {
  if (!isUtcMidnightInstant(due)) return due;
  return new Date(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate(), 23, 59, 59, 999);
}

export function civilLabel(value: Date): string {
  if (isUtcMidnightInstant(value)) {
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${value.getUTCFullYear()}-${month}-${day}`;
  }
  return deviceCivilDate(value);
}

export function occurrenceIsOnOrBeforeGoalDue(occurrence: Date, goalDueAt?: Date | string | null): boolean {
  if (goalDueAt == null || goalDueAt === '') return true;
  const due = new Date(goalDueAt);
  if (Number.isNaN(due.getTime())) return true;
  return civilLabel(occurrence) <= civilLabel(due);
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
  params: RepeatFields & { goalDueAt?: Date | string | null; notBeforeCivil?: string | null; now?: Date }
): Date | null {
  const repeat = normalizeRepeat(params.repeat);
  const now = params.now ? new Date(params.now) : new Date();
  if (Number.isNaN(now.getTime()) || !repeat) return null;
  if (params.notBeforeCivil && deviceCivilDate(now) < params.notBeforeCivil) {
    const [year, month, day] = params.notBeforeCivil.split('-').map(Number);
    const start = new Date(year, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
    return nextReminderOccurrence({ ...params, now: start, notBeforeCivil: null });
  }
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
