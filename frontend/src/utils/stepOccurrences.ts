export type OccurrenceStatus = 'DONE' | 'MISSED' | 'TODO' | 'FUTURE';

export type ScheduleStep = {
  dueAt?: string | null;
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
};

export type OccurrenceWindow = {
  start: string;
  end: string | null;
  today: string;
  archived: boolean;
  done: ReadonlySet<string>;
};

export type DatedOccurrence = { date: string; status: OccurrenceStatus };

const PAGE_GUARD = 500;

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = index - nextYear * 12 + 1;
  return { year: nextYear, month: nextMonth };
}

export function classifyDate(step: ScheduleStep, window: OccurrenceWindow, civil: string): OccurrenceStatus | null {
  if (!isScheduled(step, civil) || civil < window.start || (window.end != null && civil > window.end)) return null;
  if (window.done.has(civil)) return 'DONE';
  if (civil < window.today || window.archived) return 'MISSED';
  if (civil > window.today) return 'FUTURE';
  return 'TODO';
}

export function monthDays(step: ScheduleStep, window: OccurrenceWindow, year: number, month: number): Array<{ date: string; status: OccurrenceStatus | null }> {
  const count = daysInMonth(year, month);
  const days: Array<{ date: string; status: OccurrenceStatus | null }> = [];
  for (let day = 1; day <= count; day += 1) {
    const date = civil(year, month, day);
    days.push({ date, status: classifyDate(step, window, date) });
  }
  return days;
}

export function pageOccurrences(args: {
  step: ScheduleStep;
  window: OccurrenceWindow;
  direction: 'history' | 'upcoming';
  limit: number;
  cursor?: string | null;
}): { items: DatedOccurrence[]; hasMore: boolean } {
  const limit = Math.max(0, Math.floor(args.limit));
  const items: DatedOccurrence[] = [];
  let cursor = args.cursor ?? null;
  let guard = 0;
  while (items.length < limit && guard < PAGE_GUARD) {
    guard += 1;
    const date = args.direction === 'history'
      ? previousHistory(args.step, args.window, cursor)
      : nextUpcoming(args.step, args.window, cursor);
    if (!date || date === cursor) break;
    const status = classifyDate(args.step, args.window, date);
    if (!status) break;
    if (args.direction === 'history' && status !== 'DONE' && status !== 'MISSED') break;
    if (args.direction === 'upcoming' && status !== 'FUTURE') break;
    items.push({ date, status });
    cursor = date;
  }
  const more = args.direction === 'history'
    ? previousHistory(args.step, args.window, cursor)
    : nextUpcoming(args.step, args.window, cursor);
  return { items, hasMore: more != null && more !== cursor };
}

function previousHistory(step: ScheduleStep, window: OccurrenceWindow, before: string | null): string | null {
  const cap = before ?? (window.end && window.end < window.today ? window.end : window.today);
  const date = before ? previousScheduled(step, window, before) : scheduledOnOrBefore(step, window, cap);
  if (!date) return null;
  const status = classifyDate(step, window, date);
  if (status === 'DONE' || status === 'MISSED') return date;
  if (status === 'TODO') return previousScheduled(step, window, date);
  return null;
}

function nextUpcoming(step: ScheduleStep, window: OccurrenceWindow, after: string | null): string | null {
  const floor = after ?? addDays(window.today, 1);
  const date = after ? nextScheduled(step, window, after) : scheduledOnOrAfter(step, window, floor > window.start ? floor : window.start);
  if (!date || date <= window.today) return null;
  return classifyDate(step, window, date) === 'FUTURE' ? date : null;
}

function scheduledOnOrBefore(step: ScheduleStep, window: OccurrenceWindow, cap: string): string | null {
  if (cap < window.start) return null;
  const end = window.end && window.end < cap ? window.end : cap;
  if (end < window.start) return null;
  const repeat = normalize(step.repeat);
  if (!repeat || repeat === 'once') {
    const due = dueCivil(step.dueAt);
    return due && due >= window.start && due <= end ? due : null;
  }
  if (repeat === 'daily') return end;
  if (repeat === 'weekly' && isWeekday(step.repeatDay)) {
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(end, -index);
      if (date < window.start) return null;
      if (weekday(date) === step.repeatDay) return date;
    }
    return null;
  }
  const repeatDay = step.repeatDay;
  if (repeat === 'monthly' && isMonthDay(repeatDay)) return monthlyOnOrBefore(window.start, end, repeatDay);
  const pair = monthDayPair(step.repeatMonth, step.repeatDay);
  if (repeat === 'yearly' && pair) return yearlyOnOrBefore(window.start, end, pair.month, pair.day);
  return null;
}

function scheduledOnOrAfter(step: ScheduleStep, window: OccurrenceWindow, floor: string): string | null {
  if (window.end && floor > window.end) return null;
  const start = floor < window.start ? window.start : floor;
  const repeat = normalize(step.repeat);
  if (!repeat || repeat === 'once') {
    const due = dueCivil(step.dueAt);
    return due && due >= start && (window.end == null || due <= window.end) ? due : null;
  }
  if (repeat === 'daily') return window.end == null || start <= window.end ? start : null;
  if (repeat === 'weekly' && isWeekday(step.repeatDay)) {
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(start, index);
      if (window.end && date > window.end) return null;
      if (weekday(date) === step.repeatDay) return date;
    }
    return null;
  }
  const repeatDay = step.repeatDay;
  if (repeat === 'monthly' && isMonthDay(repeatDay)) return monthlyOnOrAfter(start, window.end, repeatDay);
  const pair = monthDayPair(step.repeatMonth, step.repeatDay);
  if (repeat === 'yearly' && pair) return yearlyOnOrAfter(start, window.end, pair.month, pair.day);
  return null;
}

function previousScheduled(step: ScheduleStep, window: OccurrenceWindow, date: string): string | null {
  return scheduledOnOrBefore(step, window, addDays(date, -1));
}

function nextScheduled(step: ScheduleStep, window: OccurrenceWindow, date: string): string | null {
  return scheduledOnOrAfter(step, window, addDays(date, 1));
}

function monthlyOnOrBefore(start: string, end: string, repeatDay: number): string | null {
  let { year, month } = parseCivil(end);
  for (let index = 0; index < 24; index += 1) {
    const date = civil(year, month, Math.min(repeatDay, daysInMonth(year, month)));
    if (date <= end && date >= start) return date;
    const shifted = shiftMonth(year, month, -1);
    year = shifted.year;
    month = shifted.month;
    if (civil(year, month, daysInMonth(year, month)) < start) return null;
  }
  return null;
}

function monthlyOnOrAfter(start: string, end: string | null, repeatDay: number): string | null {
  let { year, month } = parseCivil(start);
  for (let index = 0; index < 24; index += 1) {
    const date = civil(year, month, Math.min(repeatDay, daysInMonth(year, month)));
    if (date >= start && (end == null || date <= end)) return date;
    const shifted = shiftMonth(year, month, 1);
    year = shifted.year;
    month = shifted.month;
    if (end && civil(year, month, 1) > end) return null;
  }
  return null;
}

function yearlyOnOrBefore(start: string, end: string, repeatMonth: number, repeatDay: number): string | null {
  let year = parseCivil(end).year;
  for (let index = 0; index < 12; index += 1) {
    const date = civil(year, repeatMonth, Math.min(repeatDay, daysInMonth(year, repeatMonth)));
    if (date <= end && date >= start) return date;
    year -= 1;
    if (civil(year, repeatMonth, daysInMonth(year, repeatMonth)) < start) return null;
  }
  return null;
}

function yearlyOnOrAfter(start: string, end: string | null, repeatMonth: number, repeatDay: number): string | null {
  let year = parseCivil(start).year;
  for (let index = 0; index < 12; index += 1) {
    const date = civil(year, repeatMonth, Math.min(repeatDay, daysInMonth(year, repeatMonth)));
    if (date >= start && (end == null || date <= end)) return date;
    year += 1;
    if (end && date > end && year > parseCivil(end).year) return null;
  }
  return null;
}

function isScheduled(step: ScheduleStep, civilDate: string): boolean {
  if (!parseCivil(civilDate).year || hasConflict(step)) return false;
  const repeat = normalize(step.repeat);
  if (!repeat || repeat === 'once') return dueCivil(step.dueAt) === civilDate;
  if (repeat === 'daily') return true;
  if (repeat === 'weekly') return isWeekday(step.repeatDay) && weekday(civilDate) === step.repeatDay;
  const repeatDay = step.repeatDay;
  if (repeat === 'monthly') {
    if (!isMonthDay(repeatDay)) return false;
    const parts = parseCivil(civilDate);
    return parts.day === Math.min(repeatDay, daysInMonth(parts.year, parts.month));
  }
  if (repeat === 'yearly') {
    const pair = monthDayPair(step.repeatMonth, repeatDay);
    if (!pair) return false;
    const parts = parseCivil(civilDate);
    return parts.month === pair.month && parts.day === Math.min(pair.day, daysInMonth(parts.year, parts.month));
  }
  return false;
}

function hasConflict(step: ScheduleStep): boolean {
  const repeat = normalize(step.repeat);
  return !!step.dueAt && !!repeat && repeat !== 'once';
}

function dueCivil(value?: string | null): string | null {
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

function normalize(value?: string | null): string {
  return String(value ?? '').trim().toLowerCase();
}

function isWeekday(value?: number | null): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

function isMonthDay(value?: number | null): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31;
}

function monthDayPair(month?: number | null, day?: number | null): { month: number; day: number } | null {
  if (!isMonthDay(month) || !isMonthDay(day) || month < 1 || month > 12 || day > daysInMonth(2024, month)) return null;
  return { month, day };
}

export function addDays(value: string, days: number): string {
  const parts = parseCivil(value);
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return next.toISOString().slice(0, 10);
}

function weekday(value: string): number {
  const parts = parseCivil(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function civil(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseCivil(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return { year: 0, month: 0, day: 0 };
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}
