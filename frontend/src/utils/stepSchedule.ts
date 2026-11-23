import type { GoalStepItem } from '../api/auth';

export type StepScheduleFields = {
  dueAt?: string | null;
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
};

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

function ymdFromStored(value: string): { y: number; m: number; d: number } | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const utcMidnight =
    parsed.getUTCHours() === 0 && parsed.getUTCMinutes() === 0 && parsed.getUTCSeconds() === 0 && parsed.getUTCMilliseconds() === 0;
  if (utcMidnight) return { y: parsed.getUTCFullYear(), m: parsed.getUTCMonth() + 1, d: parsed.getUTCDate() };
  return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
}

export function scheduleToShortText(step: Pick<GoalStepItem, 'dueAt' | 'repeat' | 'repeatDay' | 'repeatMonth'>): string {
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
  if (repeat === 'weekly') return step.repeatDay !== null && step.repeatDay !== undefined ? `weekly:${formatWeekday(step.repeatDay) || String(step.repeatDay)}` : 'weekly';
  if (repeat === 'monthly') return step.repeatDay !== null && step.repeatDay !== undefined ? `monthly:${String(step.repeatDay)}` : 'monthly';
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
    const tok = raw.slice(7).trim();
    const dow = parseWeekdayToken(tok);
    return { dueAt: null, repeat: 'weekly', repeatDay: dow, repeatMonth: null };
  }

  if (lower === 'monthly') return { dueAt: null, repeat: 'monthly', repeatDay: null, repeatMonth: null };
  if (lower.startsWith('monthly:')) {
    const tok = raw.slice(8).trim();
    const day = Number(tok);
    return { dueAt: null, repeat: 'monthly', repeatDay: Number.isFinite(day) ? day : null, repeatMonth: null };
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
    const day = formatWeekday(step.repeatDay);
    return day ? `Every week on ${day}` : 'Weekly, weekday missing';
  }
  if (repeat === 'monthly') {
    if (step.repeatDay !== null && step.repeatDay !== undefined && Number.isInteger(step.repeatDay) && step.repeatDay >= 1 && step.repeatDay <= 31) {
      return `Every month on day ${step.repeatDay}`;
    }
    return 'Monthly, day missing';
  }
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
  if (repeat === 'weekly' && (step.repeatDay == null || !Number.isInteger(step.repeatDay))) return WEEKLY_SCHEDULE_RETRY;
  if (repeat === 'monthly' && (step.repeatDay == null || !Number.isInteger(step.repeatDay) || step.repeatDay < 1 || step.repeatDay > 31)) {
    return MONTHLY_SCHEDULE_RETRY;
  }
  if (repeat === 'yearly' && !yearlyMonthDayCanOccur(Number(step.repeatMonth), Number(step.repeatDay))) {
    return YEARLY_SCHEDULE_RETRY;
  }
  if (!['daily', 'weekly', 'monthly', 'yearly', 'once'].includes(repeat)) {
    return SCHEDULE_FORMAT_RETRY;
  }
  return null;
}

/** Reject drafts that the parser would silently drop or misread. Empty is a valid clear. */
const YEARLY_MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function yearlyMonthDayCanOccur(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= YEARLY_MAX_DAY[month - 1];
}

const SUPPORTED_REPEATS = new Set(['daily', 'weekly', 'monthly', 'yearly', 'once']);

export function storedScheduleError(fields: StepScheduleFields): string | null {
  const repeat = (fields.repeat ?? '').trim().toLowerCase();
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
    const tok = raw.slice(7).trim();
    if (!tok || parseWeekdayToken(tok) === null) return WEEKLY_SCHEDULE_RETRY;
    return null;
  }

  if (lower.startsWith('monthly:')) {
    const day = Number(raw.slice(8).trim());
    if (!Number.isInteger(day) || day < 1 || day > 31) return MONTHLY_SCHEDULE_RETRY;
    return null;
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
