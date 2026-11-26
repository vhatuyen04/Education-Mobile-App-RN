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
 * - custom: each stored YYYY-MM-DD value, once
 * - unscheduled, unknown, or incomplete: no occurrences
 *
 * Daily counts walk calendar days. They do not divide millisecond spans,
 * so a daylight-saving transition does not drop or duplicate a day.
 * Open-ended goals still use a 100-occurrence progress horizon. A deadline
 * that contains zero matching days stays at zero.
 */

export const RECURRENCE_POLICY_VERSION = 'clamp-last-valid-day-v1' as const;
export const RECURRENCE_START_POLICY = 'later-of-goal-and-step-created-at-v1' as const;
export const CALENDAR_POLICY_VERSION = 'utc-midnight-civil-date-v1' as const;
export const OPEN_ENDED_REPEAT_HORIZON = 100;

/**
 * Calendar-day policy utc-midnight-civil-date-v1:
 * A new date-only value is stored as UTC midnight of that civil date.
 * Readers take the UTC year-month-day and do not pass it through another zone.
 * Any other timestamp is legacy. Its civil date is the calendar day in the
 * caller-supplied zone, or the server-local calendar day when no zone is known.
 * Legacy rows are not rewritten. An exact UTC midnight creation instant is
 * indistinguishable from a civil-date encoding; application clocks almost
 * never land on that millisecond.
 */

export type StoredSchedule = {
  dueAt?: Date | string | null;
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
  /** Several weekdays or month days. Empty means the single repeatDay still applies. */
  repeatDays?: number[] | null;
  customDates?: string[] | null;
};

const MONTH_MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const SUPPORTED_REPEATS = new Set(['daily', 'weekly', 'monthly', 'yearly', 'once', 'custom']);
export const CUSTOM_DATES_LIMIT = 2000;

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

/** A real Gregorian YYYY-MM-DD. February 29 is accepted only in a leap year. */
export function isRealCivilDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInCivilMonth(year, month);
}

/** Sorted unique civil dates, or the first reason the list cannot be stored. */
export function prepareCustomDates(input: unknown): { ok: true; dates: string[] } | { ok: false; error: string } {
  if (input == null) return { ok: true, dates: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'Select at least one date, and try again.' };
  if (input.length > CUSTOM_DATES_LIMIT) {
    return { ok: false, error: `Select at most ${CUSTOM_DATES_LIMIT} dates, and try again.` };
  }
  const seen = new Set<string>();
  for (const value of input) {
    const date = typeof value === 'string' ? value.trim() : '';
    if (!isRealCivilDate(date)) return { ok: false, error: 'Pick a real calendar date, such as 2028-02-29, and try again.' };
    if (seen.has(date)) return { ok: false, error: 'Each date can be selected only once. Remove the duplicate, and try again.' };
    seen.add(date);
  }
  return { ok: true, dates: [...seen].sort() };
}

export function customDateSet(step: StoredSchedule): Set<string> {
  const prepared = prepareCustomDates(step.customDates);
  return new Set(prepared.ok ? prepared.dates : []);
}

export function isCustomSchedule(step: StoredSchedule): boolean {
  return normalizeRepeat(step.repeat) === 'custom' && customDateSet(step).size > 0;
}

export function countCustomDatesBetween(step: StoredSchedule, fromCivil: string, toCivil: string): number {
  if (!isRealCivilDate(fromCivil) || !isRealCivilDate(toCivil) || toCivil < fromCivil) return 0;
  let count = 0;
  for (const date of customDateSet(step)) {
    if (date >= fromCivil && date <= toCivil) count += 1;
  }
  return count;
}

/** Last valid day for a monthly or yearly request. Does not invent a day when the request is missing. */
export function clampedMonthDay(year: number, month: number, requestedDay: number): number {
  return Math.min(requestedDay, daysInCivilMonth(year, month));
}

/**
 * Weekdays or month days for one step. A non-empty repeatDays list wins.
 * An older row with only repeatDay is read as that one day.
 */
export function selectedRepeatDays(step: StoredSchedule, kind: 'weekly' | 'monthly'): number[] {
  const valid = kind === 'weekly' ? isWeekdayIndex : isMonthDayIndex;
  const listed = Array.isArray(step.repeatDays) ? step.repeatDays : [];
  const source = listed.length > 0 ? listed : step.repeatDay == null ? [] : [step.repeatDay];
  const unique: number[] = [];
  for (const day of source) {
    if (!valid(day) || unique.includes(day)) continue;
    unique.push(day);
  }
  unique.sort((left, right) => left - right);
  return unique;
}

/** One stored day keeps repeatDay. Several days keep the full list and the first day as a fallback. */
export function normalizedRepeatSelection(step: StoredSchedule): { repeatDay: number | null; repeatDays: number[] } {
  const repeat = normalizeRepeat(step.repeat);
  if (repeat !== 'weekly' && repeat !== 'monthly') return { repeatDay: step.repeatDay ?? null, repeatDays: [] };
  const days = selectedRepeatDays(step, repeat);
  if (days.length <= 1) return { repeatDay: days[0] ?? null, repeatDays: [] };
  return { repeatDay: days[0], repeatDays: days };
}

function repeatListError(step: StoredSchedule): string | null {
  if (!Array.isArray(step.repeatDays) || step.repeatDays.length === 0) return null;
  const repeat = normalizeRepeat(step.repeat);
  if (repeat !== 'weekly' && repeat !== 'monthly') return 'Only a weekly or monthly schedule can list several days.';
  const valid = repeat === 'weekly' ? isWeekdayIndex : isMonthDayIndex;
  const seen = new Set<number>();
  for (const day of step.repeatDays) {
    if (!valid(day)) {
      return repeat === 'weekly'
        ? 'Pick a weekday from Monday through Sunday, such as weekly:Mon, and try again.'
        : 'Pick a day from 1 through 31, such as monthly:15, and try again.';
    }
    if (seen.has(day)) return 'Each day can be selected only once. Remove the duplicate, and try again.';
    seen.add(day);
  }
  return null;
}

/** Days that occur in one month. A single day still clamps. Several days skip a day the month does not have. */
export function monthOccurrenceDays(year: number, month: number, days: number[]): number[] {
  const last = daysInCivilMonth(year, month);
  if (days.length <= 1) return days.length ? [Math.min(days[0], last)] : [];
  return days.filter(day => day <= last);
}

export function isDeterminateRepeat(step: StoredSchedule): boolean {
  const repeat = normalizeRepeat(step.repeat);
  if (repeat === 'daily') return true;
  if (repeat === 'weekly') return selectedRepeatDays(step, 'weekly').length > 0;
  if (repeat === 'monthly') return selectedRepeatDays(step, 'monthly').length > 0;
  if (repeat === 'yearly') return isCalendarMonthDay(step.repeatMonth, step.repeatDay);
  return false;
}

export function scheduleWriteError(step: StoredSchedule): string | null {
  const prepared = prepareCustomDates(step.customDates);
  if (!prepared.ok) return prepared.error;
  const repeat = normalizeRepeat(step.repeat);
  const hasDue = step.dueAt != null && step.dueAt !== '';
  if (prepared.dates.length > 0 && repeat !== 'custom') return 'A step cannot combine custom dates with another schedule';
  if (repeat === 'custom' && hasDue) return 'A step cannot have both a due date and custom dates';
  if (repeat === 'custom' && prepared.dates.length === 0) return 'Select at least one date, and try again.';
  if (hasDue && repeat && repeat !== 'once') return 'A step cannot have both a due date and a repeat';
  if (repeat && !SUPPORTED_REPEATS.has(repeat)) {
    return 'Use daily, weekly:Mon, monthly:15, yearly:02-29, or once:2026-11-22, and try again.';
  }
  if (repeat === 'once' && !hasDue) return 'Pick a real date, such as once:2026-11-22, and try again.';
  const listedDays = repeatListError(step);
  if (listedDays) return listedDays;
  if (repeat === 'weekly' && selectedRepeatDays(step, 'weekly').length === 0) {
    return 'Pick a weekday from Monday through Sunday, such as weekly:Mon, and try again.';
  }
  if (repeat === 'monthly' && selectedRepeatDays(step, 'monthly').length === 0) {
    return 'Pick a day from 1 through 31, such as monthly:15, and try again.';
  }
  if (repeat === 'yearly' && !isCalendarMonthDay(step.repeatMonth, step.repeatDay)) {
    return 'Pick a real month and day, such as yearly:02-29, and try again.';
  }
  return null;
}

/** A one-time step date may fall on the goal deadline, but not after it. */
export function stepLaterThanGoalError(
  stepDueAt: Date | string | null | undefined,
  goalDueAt: Date | string | null | undefined,
  timeZone?: string | null
): string | null {
  if (stepDueAt == null || stepDueAt === '' || goalDueAt == null || goalDueAt === '') return null;
  const stepDate = new Date(stepDueAt);
  const goalDate = new Date(goalDueAt);
  if (Number.isNaN(stepDate.getTime()) || Number.isNaN(goalDate.getTime())) return null;
  const stepDay = storedInstantCivilDate(stepDate, timeZone);
  const goalDay = storedInstantCivilDate(goalDate, timeZone);
  if (stepDay <= goalDay) return null;
  return `The step date cannot be later than the goal deadline. Pick a date on or before ${goalDay}, and try again.`;
}

/** A new step must have an occurrence on today or between today and the goal deadline. */
export function stepOutsideActiveRangeError(args: {
  step: StoredSchedule;
  todayCivil: string;
  goalDueAt?: Date | string | null;
  timeZone?: string | null;
}): string | null {
  if (!utcMidnightFromCivil(args.todayCivil) || hasScheduleConflict(args.step)) return null;
  const repeat = normalizeRepeat(args.step.repeat);
  const hasDue = args.step.dueAt != null && args.step.dueAt !== '';
  const goalDay = args.goalDueAt ? storedInstantCivilDate(new Date(args.goalDueAt), args.timeZone) : null;
  const bounded = goalDay && utcMidnightFromCivil(goalDay) ? goalDay : null;
  const message = bounded
    ? `The step date must fall between today and the goal deadline. Pick a date from ${args.todayCivil} through ${bounded}, and try again.`
    : `The step date cannot be earlier than today. Pick a date on or after ${args.todayCivil}, and try again.`;

  if (hasDue && (!repeat || repeat === 'once')) {
    const stepDate = new Date(args.step.dueAt as string);
    if (Number.isNaN(stepDate.getTime())) return null;
    if (storedInstantCivilDate(stepDate, args.timeZone) < args.todayCivil) return message;
    return null;
  }

  if (repeat === 'custom') {
    const prepared = prepareCustomDates(args.step.customDates);
    if (!prepared.ok || prepared.dates.length === 0) return null;
    const later = `The step date cannot be later than the goal deadline. Pick a date on or before ${bounded ?? args.todayCivil}, and try again.`;
    for (const date of prepared.dates) {
      if (date < args.todayCivil) return message;
      if (bounded && date > bounded) return later;
    }
    return null;
  }

  if (!isDeterminateRepeat(args.step) || !bounded) return null;
  if (bounded < args.todayCivil) return message;
  const start = civilToLocalDay(args.todayCivil);
  const end = civilToLocalDay(bounded);
  if (!start || !end) return null;
  if (countRepeatOccurrencesBetween(args.step, start, end) > 0) return null;
  return message;
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

export function isUtcMidnightInstant(value: Date): boolean {
  return (
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  );
}

export function utcMidnightFromCivil(civil: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInCivilMonth(year, month)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

export function utcCivilDate(value: Date): string {
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${String(value.getUTCFullYear()).padStart(4, '0')}-${month}-${day}`;
}

export function localCivilDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${String(value.getFullYear()).padStart(4, '0')}-${month}-${day}`;
}

export function civilToLocalDay(civil: string): Date | null {
  const utc = utcMidnightFromCivil(civil);
  if (!utc) return null;
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/**
 * The civil day used to allow a completion toggle.
 * No user timezone is stored. SCHEDULING_TIMEZONE is the authority when it is
 * a valid IANA name. Otherwise the server process zone is the authority.
 * A timezone sent by the client does not choose this day.
 */
export function authoritativeSchedulingTimeZone(configured?: string | null): string | null {
  const fromEnv = tryTimeZone(configured === undefined ? process.env.SCHEDULING_TIMEZONE : configured);
  if (fromEnv) return fromEnv;
  try {
    return tryTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

export function tryTimeZone(timeZone: string | null | undefined): string | null {
  const zone = String(timeZone ?? '').trim();
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0));
  } catch {
    return null;
  }
  return zone;
}

export function instantCivilDate(value: Date, timeZone?: string | null): string {
  const zone = tryTimeZone(timeZone);
  if (!zone) return localCivilDate(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  if (!year || !month || !day) return localCivilDate(value);
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** Explicit civil dates stay on their UTC day. Legacy instants use the supplied zone. */
export function storedInstantCivilDate(value: Date, legacyTimeZone?: string | null): string {
  if (isUtcMidnightInstant(value)) return utcCivilDate(value);
  return instantCivilDate(value, legacyTimeZone);
}

export function laterCivilDate(first: string, second: string | null | undefined): string {
  if (!second || !utcMidnightFromCivil(second)) return first;
  return second > first ? second : first;
}

export type LifecycleBoundsStep = StoredSchedule & {
  createdAt?: Date | string | null;
  archivedAt?: Date | string | null;
  effectiveFrom?: Date | string | null;
  effectiveUntil?: Date | string | null;
};

/** Inclusive civil window for one step. An archived step ends on effectiveUntil. */
export function stepProgressBounds(args: {
  step: LifecycleBoundsStep;
  goalCreatedAt: Date;
  goalDueAt?: Date | string | null;
  legacyTimeZone?: string | null;
}): { start: string; end: string | null } | null {
  const goalCreated = instantCivilDate(new Date(args.goalCreatedAt), args.legacyTimeZone);
  const stepCreated = args.step.createdAt ? instantCivilDate(new Date(args.step.createdAt), args.legacyTimeZone) : null;
  let start = laterCivilDate(goalCreated, stepCreated);
  if (args.step.effectiveFrom) start = laterCivilDate(start, storedInstantCivilDate(new Date(args.step.effectiveFrom), args.legacyTimeZone));
  const goalDue = args.goalDueAt ? storedInstantCivilDate(new Date(args.goalDueAt), args.legacyTimeZone) : null;
  let end = goalDue;
  if (args.step.archivedAt) {
    const until = args.step.effectiveUntil ? storedInstantCivilDate(new Date(args.step.effectiveUntil), args.legacyTimeZone) : null;
    if (!until) return null;
    end = end ? (until < end ? until : end) : until;
  }
  if (end && end < start) return null;
  return { start, end };
}

export function hasScheduleConflict(step: StoredSchedule): boolean {
  const repeat = normalizeRepeat(step.repeat);
  const hasDue = step.dueAt != null && step.dueAt !== '';
  return hasDue && !!repeat && repeat !== 'once';
}

export function isStepScheduledOnCivilDay(step: StoredSchedule, civilToday: string, legacyTimeZone?: string | null): boolean {
  if (!utcMidnightFromCivil(civilToday) || hasScheduleConflict(step)) return false;
  const repeat = normalizeRepeat(step.repeat);
  if (repeat === 'custom') return customDateSet(step).has(civilToday);
  if (!repeat || repeat === 'once') {
    if (!step.dueAt) return false;
    const due = new Date(step.dueAt);
    if (Number.isNaN(due.getTime())) return false;
    return storedInstantCivilDate(due, legacyTimeZone) === civilToday;
  }
  const noon = civilToLocalDay(civilToday);
  if (!noon) return false;
  noon.setHours(12, 0, 0, 0);
  return isStepScheduledOnDay(step, noon);
}

export function isStepScheduledOnDay(step: StoredSchedule, now: Date): boolean {
  if (hasScheduleConflict(step)) return false;
  const todayStart = startOfLocalDay(now);
  const todayEnd = endOfLocalDay(now);
  const repeat = normalizeRepeat(step.repeat);

  if (!repeat || repeat === 'once') {
    if (!step.dueAt) return false;
    const due = new Date(step.dueAt);
    return due.getTime() >= todayStart.getTime() && due.getTime() <= todayEnd.getTime();
  }

  if (repeat === 'custom') return customDateSet(step).has(localCivilDate(now));

  if (repeat === 'daily') return true;

  if (repeat === 'weekly') {
    const days = selectedRepeatDays(step, 'weekly');
    return days.includes(now.getDay());
  }

  if (repeat === 'monthly') {
    const days = selectedRepeatDays(step, 'monthly');
    if (!days.length) return false;
    const today = now.getDate();
    if (days.length === 1) return today === clampedMonthDay(now.getFullYear(), now.getMonth() + 1, days[0]);
    return days.includes(today);
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

  if (repeat === 'custom') {
    const fromCivil = localCivilDate(from);
    const toCivil = localCivilDate(to);
    return countCustomDatesBetween(step, fromCivil, toCivil);
  }

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
    const days = selectedRepeatDays(step, 'weekly');
    if (!days.length) return 0;
    let count = 0;
    const cur = new Date(from);
    while (cur.getTime() <= to.getTime()) {
      if (days.includes(cur.getDay())) count += 1;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  if (repeat === 'monthly') {
    const days = selectedRepeatDays(step, 'monthly');
    if (!days.length) return 0;
    let count = 0;
    let year = from.getFullYear();
    let month = from.getMonth();
    for (let guard = 0; guard < 2400; guard += 1) {
      const occurring = monthOccurrenceDays(year, month + 1, days);
      let finished = false;
      for (const day of occurring) {
        const occ = new Date(year, month, day);
        if (occ.getTime() > to.getTime()) {
          finished = true;
          break;
        }
        if (occ.getTime() >= from.getTime()) count += 1;
      }
      if (finished) break;
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

/**
 * Goal progress is done occurrences divided by expected occurrences.
 * Each scheduled day has equal weight. A goal with no deadline does not use
 * this percentage. The 100-occurrence horizon stays inside
 * expectedRepeatOccurrences for other callers.
 * Edited schedules are read as they are saved now. There is no schedule history,
 * so an older completion is judged against the latest saved schedule.
 * This percentage is not the goal's completed flag.
 */
export function dashboardProgressPercent(args: {
  steps: Array<LifecycleBoundsStep & { id: string }>;
  completions?: Array<{ stepId: string; date: Date | string }>;
  goalCreatedAt: Date;
  goalDueAt?: Date | string | null;
  legacyTimeZone?: string | null;
}): number {
  if (!args.goalDueAt) return 0;
  const stepsById = new Map(args.steps.map(step => [step.id, step]));
  const bounds = new Map<string, { start: string; due: string }>();
  let totalExpected = 0;

  for (const step of args.steps) {
    if (hasScheduleConflict(step)) continue;
    const window = stepProgressBounds({
      step,
      goalCreatedAt: args.goalCreatedAt,
      goalDueAt: args.goalDueAt,
      legacyTimeZone: args.legacyTimeZone,
    });
    if (!window?.end) continue;
    const startDay = civilToLocalDay(window.start);
    const endDay = civilToLocalDay(window.end);
    if (!startDay || !endDay) continue;
    const repeat = normalizeRepeat(step.repeat);
    let expected = 0;
    if (step.dueAt && !repeat) {
      const dueCivil = storedInstantCivilDate(new Date(step.dueAt), args.legacyTimeZone);
      if (dueCivil >= window.start && dueCivil <= window.end) expected = 1;
    } else if (isCustomSchedule(step)) {
      expected = countCustomDatesBetween(step, window.start, window.end);
    } else if (isDeterminateRepeat(step)) {
      expected = expectedRepeatOccurrences(step, startDay, endDay);
    }
    if (expected <= 0) continue;
    totalExpected += expected;
    bounds.set(step.id, { start: window.start, due: window.end });
  }

  if (totalExpected <= 0) return 0;
  const seen = new Set<string>();
  let totalDone = 0;
  for (const row of args.completions ?? []) {
    const step = stepsById.get(row.stepId);
    const window = bounds.get(row.stepId);
    if (!step || !window) continue;
    const date = new Date(row.date);
    if (Number.isNaN(date.getTime())) continue;
    const civil = storedInstantCivilDate(date, args.legacyTimeZone);
    if (civil < window.start || civil > window.due) continue;
    if (!isStepScheduledOnCivilDay(step, civil, args.legacyTimeZone)) continue;
    const key = `${row.stepId}|${civil}`;
    if (seen.has(key)) continue;
    seen.add(key);
    totalDone += 1;
  }

  return Number((Math.min(totalDone / totalExpected, 1) * 100).toFixed(2));
}

/**
 * Today's checklist uses the same occurrence rules as goal progress.
 * Archived steps still count when today is inside their window.
 * Null means nothing is scheduled today.
 */
export function todayOccurrencePercent(args: {
  steps: Array<LifecycleBoundsStep & { id: string }>;
  completions?: Array<{ stepId: string; date: Date | string }>;
  goalCreatedAt: Date;
  goalDueAt?: Date | string | null;
  civilToday: string;
  legacyTimeZone?: string | null;
}): number | null {
  if (!utcMidnightFromCivil(args.civilToday)) return null;
  const doneToday = new Set<string>();
  for (const row of args.completions ?? []) {
    const date = new Date(row.date);
    if (Number.isNaN(date.getTime())) continue;
    if (storedInstantCivilDate(date, args.legacyTimeZone) !== args.civilToday) continue;
    doneToday.add(row.stepId);
  }

  let expected = 0;
  let done = 0;
  for (const step of args.steps) {
    if (hasScheduleConflict(step)) continue;
    const window = stepProgressBounds({
      step,
      goalCreatedAt: args.goalCreatedAt,
      goalDueAt: args.goalDueAt,
      legacyTimeZone: args.legacyTimeZone,
    });
    if (!window || args.civilToday < window.start || (window.end && args.civilToday > window.end)) continue;
    const repeat = normalizeRepeat(step.repeat);
    const scheduled = step.dueAt && !repeat
      ? storedInstantCivilDate(new Date(step.dueAt), args.legacyTimeZone) === args.civilToday
      : (isCustomSchedule(step) || isDeterminateRepeat(step)) && isStepScheduledOnCivilDay(step, args.civilToday, args.legacyTimeZone);
    if (!scheduled) continue;
    expected += 1;
    if (doneToday.has(step.id)) done += 1;
  }

  if (expected <= 0) return null;
  return Number((Math.min(done / expected, 1) * 100).toFixed(2));
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
