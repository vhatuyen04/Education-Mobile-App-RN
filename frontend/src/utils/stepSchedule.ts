import type { GoalStepItem } from '../api/auth';
import { countRepeatOccurrencesUntilDeadline, deviceCivilDate } from './recurrence';

export type StepScheduleFields = {
  dueAt?: string | null;
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
  repeatDays?: number[] | null;
  customDates?: string[] | null;
};

export const CUSTOM_DATES_LIMIT = 2000;
export const CUSTOM_DATES_EMPTY = 'Select at least one date, and try again.';
export const CUSTOM_DATES_DUPLICATE = 'Each date can be selected only once. Remove the duplicate, and try again.';
export const CUSTOM_DATES_INVALID = 'Pick a real calendar date, such as 2028-02-29, and try again.';

export const DAILY_SCHEDULE_RETRY = 'Use daily by itself, with no extra text, and try again.';
export const WEEKLY_SCHEDULE_RETRY = 'Pick a weekday from Monday through Sunday, such as weekly:Mon, and try again.';
export const MONTHLY_SCHEDULE_RETRY = 'Pick a day from 1 through 31, such as monthly:15, and try again.';
export const YEARLY_SCHEDULE_RETRY = 'Pick a real month and day, such as yearly:02-29, and try again.';
export const ONCE_SCHEDULE_RETRY = 'Pick a real date, such as once:2026-11-22, and try again.';
export const SCHEDULE_FORMAT_RETRY = 'Use daily, weekly:Mon, monthly:15, yearly:02-29, or once:2026-11-22, and try again.';

export function formatWeekday(d: number | null | undefined) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (d === null || d === undefined) return '';
  const idx = Number(d);
  if (!Number.isFinite(idx) || idx < 0 || idx > 6) return '';
  return days[idx];
}

function mondayFirst(days: number[]): number[] {
  return [...days].sort((left, right) => ((left + 6) % 7) - ((right + 6) % 7));
}

export function parseWeekdayList(raw: string): number[] | null {
  const days: number[] = [];
  for (const token of raw.split(',')) {
    const day = parseWeekdayToken(token);
    if (day == null || days.includes(day)) return null;
    days.push(day);
  }
  days.sort((left, right) => left - right);
  return days.length ? days : null;
}

export function parseMonthDayList(raw: string): number[] | null {
  const days: number[] = [];
  for (const token of raw.split(',')) {
    const day = Number(token.trim());
    if (!Number.isInteger(day) || day < 1 || day > 31 || days.includes(day)) return null;
    days.push(day);
  }
  days.sort((left, right) => left - right);
  return days.length ? days : null;
}

function listedDays(step: { repeatDay?: number | null; repeatDays?: number[] | null }, kind: 'weekly' | 'monthly'): number[] {
  const valid = kind === 'weekly'
    ? (day: number) => Number.isInteger(day) && day >= 0 && day <= 6
    : (day: number) => Number.isInteger(day) && day >= 1 && day <= 31;
  const listed = Array.isArray(step.repeatDays) ? step.repeatDays.filter(valid) : [];
  if (listed.length) return [...new Set(listed)].sort((left, right) => left - right);
  return step.repeatDay != null && valid(step.repeatDay) ? [step.repeatDay] : [];
}

function ymdFromStored(value: string): { y: number; m: number; d: number } | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const utcMidnight =
    parsed.getUTCHours() === 0 && parsed.getUTCMinutes() === 0 && parsed.getUTCSeconds() === 0 && parsed.getUTCMilliseconds() === 0;
  if (utcMidnight) return { y: parsed.getUTCFullYear(), m: parsed.getUTCMonth() + 1, d: parsed.getUTCDate() };
  return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
}

export function scheduleToShortText(step: Pick<GoalStepItem, 'dueAt' | 'repeat' | 'repeatDay' | 'repeatMonth'> & { repeatDays?: number[] | null; customDates?: string[] | null }): string {
  const repeatName = (step.repeat ?? '').trim().toLowerCase();
  if (repeatName === 'custom') {
    const dates = normalizedCustomDates(step.customDates);
    return dates.length ? `custom:${dates.join(',')}` : 'custom:';
  }
  if (step.dueAt) {
    const parts = ymdFromStored(step.dueAt);
    if (!parts) return 'once:';
    const m = String(parts.m).padStart(2, '0');
    const day = String(parts.d).padStart(2, '0');
    return `once:${parts.y}-${m}-${day}`;
  }
  const repeat = (step.repeat ?? '').trim().toLowerCase();
  if (!repeat) return '';
  if (repeat === 'daily') return 'daily';
  if (repeat === 'weekly') {
    const days = mondayFirst(listedDays(step, 'weekly'));
    return days.length ? `weekly:${days.map(day => formatWeekday(day)).join(',')}` : 'weekly';
  }
  if (repeat === 'monthly') {
    const days = listedDays(step, 'monthly');
    return days.length ? `monthly:${days.join(',')}` : 'monthly';
  }
  if (repeat === 'yearly') {
    if (step.repeatMonth && step.repeatDay) {
      return `yearly:${String(step.repeatMonth).padStart(2, '0')}-${String(step.repeatDay).padStart(2, '0')}`;
    }
    return 'yearly';
  }
  return `repeat:${step.repeat}`;
}

export function parseWeekdayToken(token: string): number | null {
  const t = token.trim().toLowerCase();
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
  if (t in map) return map[t];
  const n = Number(t);
  if (Number.isFinite(n) && n >= 0 && n <= 6) return n;
  return null;
}

export function parseScheduleShortText(input: string): StepScheduleFields {
  const raw = String(input ?? '').trim();
  if (!raw) return { dueAt: null, repeat: null, repeatDay: null, repeatMonth: null };
  const lower = raw.toLowerCase();

  if (lower.startsWith('once:')) {
    const due = raw.slice(5).trim();
    const m = due.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { dueAt: null, repeat: null, repeatDay: null, repeatMonth: null };
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return { dueAt: d.toISOString(), repeat: null, repeatDay: null, repeatMonth: null };
  }

  if (lower === 'daily') return { dueAt: null, repeat: 'daily', repeatDay: null, repeatMonth: null };

  if (lower === 'weekly') return { dueAt: null, repeat: 'weekly', repeatDay: null, repeatMonth: null };
  if (lower.startsWith('weekly:')) {
    const days = parseWeekdayList(raw.slice(7));
    if (!days) return { dueAt: null, repeat: 'weekly', repeatDay: null, repeatMonth: null };
    return { dueAt: null, repeat: 'weekly', repeatDay: days[0], repeatMonth: null, ...(days.length > 1 ? { repeatDays: days } : null) };
  }

  if (lower === 'monthly') return { dueAt: null, repeat: 'monthly', repeatDay: null, repeatMonth: null };
  if (lower.startsWith('monthly:')) {
    const days = parseMonthDayList(raw.slice(8));
    if (!days) return { dueAt: null, repeat: 'monthly', repeatDay: null, repeatMonth: null };
    return { dueAt: null, repeat: 'monthly', repeatDay: days[0], repeatMonth: null, ...(days.length > 1 ? { repeatDays: days } : null) };
  }

  if (lower === 'custom' || lower === 'custom:') {
    return { dueAt: null, repeat: 'custom', repeatDay: null, repeatMonth: null, customDates: [] };
  }
  if (lower.startsWith('custom:')) {
    const dates = raw.slice(7).split(',').map(part => part.trim()).filter(Boolean);
    return { dueAt: null, repeat: 'custom', repeatDay: null, repeatMonth: null, customDates: dates };
  }

  if (lower === 'yearly') return { dueAt: null, repeat: 'yearly', repeatDay: null, repeatMonth: null };
  if (lower.startsWith('yearly:')) {
    const tok = raw.slice(7).trim();
    const m = tok.match(/^(\d{1,2})\s*[-/.,]\s*(\d{1,2})$/);
    if (!m) return { dueAt: null, repeat: 'yearly', repeatDay: null, repeatMonth: null };
    const month = Number(m[1]);
    const day = Number(m[2]);
    return {
      dueAt: null,
      repeat: 'yearly',
      repeatMonth: Number.isFinite(month) ? month : null,
      repeatDay: Number.isFinite(day) ? day : null,
    };
  }

  return { dueAt: null, repeat: null, repeatDay: null, repeatMonth: null };
}

export function describeStepSchedule(step: StepScheduleFields): string {
  if (step.dueAt) {
    const parts = ymdFromStored(step.dueAt);
    if (!parts) return 'Once';
    return `Once on ${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
  }
  const repeat = (step.repeat ?? '').trim().toLowerCase();
  if (!repeat) return 'No schedule';
  if (repeat === 'daily') return 'Every day';
  if (repeat === 'weekly') {
    const names = mondayFirst(listedDays(step, 'weekly')).map(day => formatWeekday(day)).filter(Boolean);
    return names.length ? `Every week on ${names.join(', ')}` : 'Weekly, weekday missing';
  }
  if (repeat === 'monthly') {
    const days = listedDays(step, 'monthly');
    if (days.length === 1) return `Every month on day ${days[0]}`;
    if (days.length > 1) return `Every month on days ${days.join(', ')}`;
    return 'Monthly, day missing';
  }
  if (repeat === 'custom') return customDatesSummary(step.customDates ?? []);
  if (repeat === 'yearly') {
    if (yearlyMonthDayCanOccur(Number(step.repeatMonth), Number(step.repeatDay))) {
      return `Every year on ${String(step.repeatMonth).padStart(2, '0')}-${String(step.repeatDay).padStart(2, '0')}`;
    }
    return 'Yearly, date missing';
  }
  return `Unsupported schedule: ${step.repeat}`;
}

export function legacyScheduleNote(step: StepScheduleFields & { dueAt?: string | null }): string | null {
  const repeat = (step.repeat ?? '').trim().toLowerCase();
  if (step.dueAt && repeat && repeat !== 'once') return 'This step has both a due date and a repeat. Choose one schedule.';
  if (!repeat) return null;
  if (repeat === 'weekly' && listedDays(step, 'weekly').length === 0) return WEEKLY_SCHEDULE_RETRY;
  if (repeat === 'monthly' && listedDays(step, 'monthly').length === 0) return MONTHLY_SCHEDULE_RETRY;
  if (repeat === 'yearly' && !yearlyMonthDayCanOccur(Number(step.repeatMonth), Number(step.repeatDay))) {
    return YEARLY_SCHEDULE_RETRY;
  }
  if (repeat === 'custom') return customDatesError(step.customDates);
  if (!['daily', 'weekly', 'monthly', 'yearly', 'once', 'custom'].includes(repeat)) {
    return SCHEDULE_FORMAT_RETRY;
  }
  return null;
}

/** Reject drafts that the parser would silently drop or misread. Empty is a valid clear. */
const YEARLY_MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function yearlyMonthDayCanOccur(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= YEARLY_MAX_DAY[month - 1];
}

const SUPPORTED_REPEATS = new Set(['daily', 'weekly', 'monthly', 'yearly', 'once', 'custom']);

export function storedScheduleError(fields: StepScheduleFields): string | null {
  const repeat = (fields.repeat ?? '').trim().toLowerCase();
  const datesError = customDatesError(fields.customDates);
  if (datesError && (repeat === 'custom' || (fields.customDates?.length ?? 0) > 0)) return datesError;
  if ((fields.customDates?.length ?? 0) > 0 && repeat !== 'custom') return 'A step cannot combine custom dates with another schedule';
  if (repeat === 'custom' && fields.dueAt) return 'A step cannot have both a due date and custom dates';
  if (repeat === 'custom' && normalizedCustomDates(fields.customDates).length === 0) return CUSTOM_DATES_EMPTY;
  if (fields.dueAt && repeat && repeat !== 'once') return 'A step cannot have both a due date and a repeat';
  if (repeat && !SUPPORTED_REPEATS.has(repeat)) return SCHEDULE_FORMAT_RETRY;
  if (repeat === 'weekly') {
    const day = fields.repeatDay;
    if (day == null || !Number.isInteger(day) || day < 0 || day > 6) return WEEKLY_SCHEDULE_RETRY;
  }
  if (repeat === 'monthly') {
    const day = fields.repeatDay;
    if (day == null || !Number.isInteger(day) || day < 1 || day > 31) return MONTHLY_SCHEDULE_RETRY;
  }
  if (repeat === 'yearly') {
    if (!yearlyMonthDayCanOccur(Number(fields.repeatMonth), Number(fields.repeatDay))) return YEARLY_SCHEDULE_RETRY;
  }
  return null;
}

/** A one-time step may fall on the goal deadline, but not after it. */
export function stepDateAfterGoalError(stepDueAt?: string | null, goalDueAt?: string | null): string | null {
  const stepDay = civilDay(stepDueAt);
  const goalDay = civilDay(goalDueAt);
  if (!stepDay || !goalDay || stepDay <= goalDay) return null;
  return `The step date cannot be later than the goal deadline. Pick a date on or before ${goalDay}, and try again.`;
}

/** A new step must occur today or on a later day through the goal deadline. */
export function stepOutsideActiveRangeError(
  step: StepScheduleFields,
  goalDueAt?: string | null,
  todayCivil: string = deviceCivilDate()
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayCivil)) return null;
  const repeat = String(step.repeat ?? '').trim().toLowerCase();
  const due = civilDay(step.dueAt);
  const goalDay = civilDay(goalDueAt);
  const message = goalDay
    ? `The step date must fall between today and the goal deadline. Pick a date from ${todayCivil} through ${goalDay}, and try again.`
    : `The step date cannot be earlier than today. Pick a date on or after ${todayCivil}, and try again.`;
  if (due && (!repeat || repeat === 'once')) return due < todayCivil ? message : null;
  if (repeat === 'custom') {
    const dates = normalizedCustomDates(step.customDates);
    if (!dates.length) return null;
    const later = goalDay
      ? `The step date cannot be later than the goal deadline. Pick a date on or before ${goalDay}, and try again.`
      : null;
    for (const date of dates) {
      if (!isRealCivilDate(date)) return CUSTOM_DATES_INVALID;
      if (date < todayCivil) return message;
      if (later && goalDay && date > goalDay) return later;
    }
    return null;
  }
  if (!goalDay || !['daily', 'weekly', 'monthly', 'yearly'].includes(repeat)) return null;
  if (goalDay < todayCivil) return message;
  const start = civilToLocalDate(todayCivil);
  const end = civilToLocalDate(goalDay);
  if (!start || !end) return null;
  const counted = countRepeatOccurrencesUntilDeadline({
    repeat,
    repeatDay: step.repeatDay,
    repeatMonth: step.repeatMonth,
    repeatDays: step.repeatDays,
    start,
    deadline: end,
  });
  return counted.count > 0 ? null : message;
}

function civilToLocalDate(civil: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function civilDay(value?: string | null): string | null {
  const raw = String(value ?? '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (!match) return null;
  if (!raw.includes('T') || /T00:00:00/.test(raw)) return match[1];
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function scheduleDraftError(input: string): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (lower === 'daily') return null;
  if (lower.startsWith('daily:') || lower.startsWith('daily ')) return DAILY_SCHEDULE_RETRY;
  if (lower === 'weekly') return WEEKLY_SCHEDULE_RETRY;
  if (lower === 'monthly') return MONTHLY_SCHEDULE_RETRY;
  if (lower === 'yearly') return YEARLY_SCHEDULE_RETRY;
  if (lower === 'once') return ONCE_SCHEDULE_RETRY;

  if (lower.startsWith('once:')) {
    const due = raw.slice(5).trim();
    const match = due.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return ONCE_SCHEDULE_RETRY;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const max = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (month < 1 || month > 12 || day < 1 || day > max) return ONCE_SCHEDULE_RETRY;
    return null;
  }

  if (lower.startsWith('weekly:')) {
    return parseWeekdayList(raw.slice(7)) ? null : WEEKLY_SCHEDULE_RETRY;
  }

  if (lower.startsWith('monthly:')) {
    return parseMonthDayList(raw.slice(8)) ? null : MONTHLY_SCHEDULE_RETRY;
  }

  if (lower === 'custom' || lower === 'custom:') return CUSTOM_DATES_EMPTY;
  if (lower.startsWith('custom:')) {
    return customDatesError(raw.slice(7).split(',').map(part => part.trim()).filter(Boolean)) ?? (raw.slice(7).split(',').some(part => part.trim()) ? null : CUSTOM_DATES_EMPTY);
  }

  if (lower.startsWith('yearly:')) {
    const m = raw.slice(7).trim().match(/^(\d{1,2})\s*[-/.,]\s*(\d{1,2})$/);
    if (!m) return YEARLY_SCHEDULE_RETRY;
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (!Number.isInteger(month) || !Number.isInteger(day) || !yearlyMonthDayCanOccur(month, day)) {
      return YEARLY_SCHEDULE_RETRY;
    }
    return null;
  }

  return SCHEDULE_FORMAT_RETRY;
}

export function isRealCivilDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function customDatesError(input?: string[] | null): string | null {
  if (input == null) return null;
  if (input.length > CUSTOM_DATES_LIMIT) return `Select at most ${CUSTOM_DATES_LIMIT} dates, and try again.`;
  const seen = new Set<string>();
  for (const value of input) {
    const date = String(value ?? '').trim();
    if (!isRealCivilDate(date)) return CUSTOM_DATES_INVALID;
    if (seen.has(date)) return CUSTOM_DATES_DUPLICATE;
    seen.add(date);
  }
  return null;
}

export function normalizedCustomDates(input?: string[] | null): string[] {
  if (!input?.length || customDatesError(input)) return [];
  return [...new Set(input.map(date => date.trim()))].sort();
}

export function toggleCustomDate(dates: string[], date: string): string[] {
  if (!isRealCivilDate(date)) return normalizedCustomDates(dates);
  const next = dates.includes(date) ? dates.filter(item => item !== date) : [...dates, date];
  return normalizedCustomDates(next);
}

export function customDatesText(dates: string[]): string {
  const clean = normalizedCustomDates(dates);
  return clean.length ? `custom:${clean.join(',')}` : 'custom:';
}

export function isCustomDateDisabled(date: string, today: string, goalDue?: string | null): boolean {
  if (!isRealCivilDate(date) || !isRealCivilDate(today)) return true;
  if (date < today) return true;
  return !!goalDue && isRealCivilDate(goalDue) && date > goalDue;
}

export function customDatesSummary(dates: string[]): string {
  const clean = normalizedCustomDates(dates);
  if (!clean.length) return 'Custom schedule · no dates';
  if (clean.length === 1) return `Custom schedule · 1 date · ${clean[0]}`;
  return `Custom schedule · ${clean.length} dates · ${clean[0]} – ${clean[clean.length - 1]}`;
}
