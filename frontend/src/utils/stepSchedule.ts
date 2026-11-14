import type { GoalStepItem } from '../api/auth';

export type StepScheduleFields = {
  dueAt?: string | null;
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
};

export function formatWeekday(d: number | null | undefined) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (d === null || d === undefined) return '';
  const idx = Number(d);
  if (!Number.isFinite(idx) || idx < 0 || idx > 6) return '';
  return days[idx];
}

export function scheduleToShortText(step: Pick<GoalStepItem, 'dueAt' | 'repeat' | 'repeatDay' | 'repeatMonth'>): string {
  if (step.dueAt) {
    const d = new Date(step.dueAt);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `once:${y}-${m}-${day}`;
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
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
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

  if (lower.startsWith('repeat:')) {
    const repeat = raw.slice(7).trim();
    return { dueAt: null, repeat: repeat || null, repeatDay: null, repeatMonth: null };
  }

  return { dueAt: null, repeat: raw, repeatDay: null, repeatMonth: null };
}

export function describeStepSchedule(step: StepScheduleFields): string {
  if (step.dueAt) {
    const d = new Date(step.dueAt);
    if (!Number.isFinite(d.getTime())) return 'Once';
    return `Once on ${d.toLocaleDateString()}`;
  }
  const repeat = (step.repeat ?? '').trim().toLowerCase();
  if (!repeat) return 'No schedule';
  if (repeat === 'daily') return 'Every day';
  if (repeat === 'weekly') {
    const day = formatWeekday(step.repeatDay);
    return day ? `Every week on ${day}` : 'Every week';
  }
  if (repeat === 'monthly') {
    if (step.repeatDay !== null && step.repeatDay !== undefined) return `Every month on day ${step.repeatDay}`;
    return 'Every month';
  }
  if (repeat === 'yearly') {
    if (step.repeatMonth && step.repeatDay) {
      return `Every year on ${String(step.repeatMonth).padStart(2, '0')}-${String(step.repeatDay).padStart(2, '0')}`;
    }
    return 'Every year';
  }
  return `Repeat: ${step.repeat}`;
}

/** Reject drafts that the parser would silently drop or misread. Empty is a valid clear. */
export function scheduleDraftError(input: string): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (lower === 'daily' || lower === 'weekly' || lower === 'monthly' || lower === 'yearly') return null;

  if (lower.startsWith('once:')) {
    const due = raw.slice(5).trim();
    if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(due)) return 'Use once:YYYY-MM-DD';
    return null;
  }

  if (lower.startsWith('weekly:')) {
    const tok = raw.slice(7).trim();
    if (!tok || parseWeekdayToken(tok) === null) return 'Use weekly:Mon (Sun–Sat)';
    return null;
  }

  if (lower.startsWith('monthly:')) {
    const day = Number(raw.slice(8).trim());
    if (!Number.isInteger(day) || day < 1 || day > 31) return 'Use monthly:1–31';
    return null;
  }

  if (lower.startsWith('yearly:')) {
    const m = raw.slice(7).trim().match(/^(\d{1,2})\s*[-/.,]\s*(\d{1,2})$/);
    if (!m) return 'Use yearly:MM-DD';
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
      return 'Use yearly:MM-DD';
    }
    return null;
  }

  if (lower.startsWith('repeat:')) {
    if (!raw.slice(7).trim()) return 'Repeat type is empty';
    return null;
  }

  return null;
}
