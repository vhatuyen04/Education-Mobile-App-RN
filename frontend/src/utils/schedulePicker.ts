import { deviceCivilDate } from './recurrence';
import { isRealCivilDate, parseScheduleShortText } from './stepSchedule';

export const CUSTOM_DATES_LIMIT = 2000;
export const NEED_END_DATE = 'Pick an end date. This custom schedule will include only dates from today through that day.';
export const TOO_MANY_DATES = 'This custom schedule would contain more than 2000 dates. Keep the repeating schedule, or choose a shorter end date.';
export const REPLACE_CHANGES = 'Applying this choice will replace your date changes.';

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEK_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_MAX = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export type Preset = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'once' | 'manual';

export type PickerDraft = {
  preset: Preset | null;
  weekday: number;
  monthDay: number;
  yearMonth: number;
  yearDay: number;
  onceDate: string | null;
  added: string[];
  removed: string[];
  customUntil: string | null;
};

export type ScheduleRange = {
  start: string;
  deadline: string | null;
};

export type PendingChange =
  | { type: 'preset'; preset: Preset }
  | { type: 'weekday'; weekday: number }
  | { type: 'monthDay'; monthDay: number }
  | { type: 'yearMonth'; yearMonth: number }
  | { type: 'yearDay'; yearDay: number };

export function emptyDraft(): PickerDraft {
  return {
    preset: null,
    weekday: 1,
    monthDay: 15,
    yearMonth: 12,
    yearDay: 15,
    onceDate: null,
    added: [],
    removed: [],
    customUntil: null,
  };
}

export function scheduleRange(goalDueAt?: string | null, start: string = deviceCivilDate()): ScheduleRange {
  return { start, deadline: storedCivilDay(goalDueAt) };
}

export function draftFromScheduleText(text: string): PickerDraft {
  const base = emptyDraft();
  const raw = String(text ?? '').trim();
  if (!raw) return base;
  const parsed = parseScheduleShortText(raw);
  const repeat = String(parsed.repeat ?? '').trim().toLowerCase();
  if (repeat === 'daily') return { ...base, preset: 'daily' };
  if (repeat === 'weekly' && isWeekday(parsed.repeatDay)) return { ...base, preset: 'weekly', weekday: parsed.repeatDay };
  if (repeat === 'monthly' && isMonthDay(parsed.repeatDay)) return { ...base, preset: 'monthly', monthDay: parsed.repeatDay };
  if (repeat === 'yearly' && isYearDay(parsed.repeatMonth, parsed.repeatDay)) {
    return { ...base, preset: 'yearly', yearMonth: parsed.repeatMonth as number, yearDay: parsed.repeatDay as number };
  }
  if (repeat === 'custom') return { ...base, preset: 'manual', added: sortUnique(parsed.customDates ?? []) };
  const once = storedCivilDay(parsed.dueAt);
  if (once) return { ...base, preset: 'once', onceDate: once };
  return base;
}

export function isCustomized(draft: PickerDraft, range: ScheduleRange): boolean {
  if (draft.added.length > 0 || draft.removed.length > 0) return true;
  if (!draft.customUntil || draft.preset === 'manual' || draft.preset === 'once' || draft.preset == null) return false;
  if (!range.deadline) return true;
  return draft.customUntil < range.deadline;
}

export function dateEligible(date: string, range: ScheduleRange): boolean {
  if (!isRealCivilDate(date) || !isRealCivilDate(range.start)) return false;
  if (date < range.start) return false;
  if (range.deadline && date > range.deadline) return false;
  return true;
}

export function isDateSelected(draft: PickerDraft, date: string, range: ScheduleRange): boolean {
  if (!dateEligible(date, range)) return false;
  if (draft.preset === 'manual') return draft.added.includes(date);
  if (draft.preset == null) return false;
  const end = activeEnd(draft, range);
  if (end && date > end) return false;
  if (draft.removed.includes(date)) return false;
  if (draft.added.includes(date)) return true;
  if (draft.preset === 'once') return date === draft.onceDate;
  return matchesPreset(draft, date);
}

export function toggleDate(draft: PickerDraft, date: string, range: ScheduleRange): PickerDraft {
  if (!dateEligible(date, range)) return draft;
  if (draft.preset == null || draft.preset === 'manual') {
    return { ...draft, preset: 'manual', added: toggleList(draft.added, date), removed: [] };
  }
  if (draft.preset === 'once' && !isCustomized(draft, range)) {
    return { ...draft, onceDate: draft.onceDate === date ? null : date };
  }
  if (isDateSelected(draft, date, range)) {
    if (draft.added.includes(date)) return { ...draft, added: without(draft.added, date) };
    return { ...draft, removed: sortUnique([...draft.removed, date]) };
  }
  if (draft.removed.includes(date)) return { ...draft, removed: without(draft.removed, date) };
  return { ...draft, added: sortUnique([...draft.added, date]) };
}

export function requestPreset(draft: PickerDraft, preset: Preset, range: ScheduleRange): { draft: PickerDraft; confirm: boolean } {
  if (draft.preset === preset && !isCustomized(draft, range)) return { draft, confirm: false };
  if (isCustomized(draft, range)) return { draft, confirm: true };
  return { draft: commitPreset(draft, preset), confirm: false };
}

export function commitPreset(draft: PickerDraft, preset: Preset): PickerDraft {
  return { ...draft, preset, added: [], removed: [], onceDate: null, customUntil: null };
}

export function requestWeekday(draft: PickerDraft, weekday: number, range: ScheduleRange): { draft: PickerDraft; confirm: boolean } {
  if (!isWeekday(weekday) || (draft.preset === 'weekly' && draft.weekday === weekday)) return { draft, confirm: false };
  if (isCustomized(draft, range)) return { draft, confirm: true };
  return { draft: commitWeekday(draft, weekday), confirm: false };
}

export function commitWeekday(draft: PickerDraft, weekday: number): PickerDraft {
  return { ...commitPreset(draft, 'weekly'), weekday };
}

export function requestMonthDay(draft: PickerDraft, monthDay: number, range: ScheduleRange): { draft: PickerDraft; confirm: boolean } {
  if (!isMonthDay(monthDay) || (draft.preset === 'monthly' && draft.monthDay === monthDay)) return { draft, confirm: false };
  if (isCustomized(draft, range)) return { draft, confirm: true };
  return { draft: commitMonthDay(draft, monthDay), confirm: false };
}

export function commitMonthDay(draft: PickerDraft, monthDay: number): PickerDraft {
  return { ...commitPreset(draft, 'monthly'), monthDay };
}

export function requestYearMonth(draft: PickerDraft, yearMonth: number, range: ScheduleRange): { draft: PickerDraft; confirm: boolean } {
  if (yearMonth < 1 || yearMonth > 12 || (draft.preset === 'yearly' && draft.yearMonth === yearMonth)) return { draft, confirm: false };
  if (isCustomized(draft, range)) return { draft, confirm: true };
  return { draft: commitYearMonth(draft, yearMonth), confirm: false };
}

export function commitYearMonth(draft: PickerDraft, yearMonth: number): PickerDraft {
  const yearDay = Math.min(draft.yearDay, MONTH_MAX[yearMonth - 1] ?? 31);
  return { ...commitPreset(draft, 'yearly'), yearMonth, yearDay };
}

export function requestYearDay(draft: PickerDraft, yearDay: number, range: ScheduleRange): { draft: PickerDraft; confirm: boolean } {
  const max = MONTH_MAX[draft.yearMonth - 1] ?? 31;
  if (yearDay < 1 || yearDay > max || (draft.preset === 'yearly' && draft.yearDay === yearDay)) return { draft, confirm: false };
  if (isCustomized(draft, range)) return { draft, confirm: true };
  return { draft: commitYearDay(draft, yearDay), confirm: false };
}

export function commitYearDay(draft: PickerDraft, yearDay: number): PickerDraft {
  return { ...commitPreset(draft, 'yearly'), yearDay };
}

export function applyPending(draft: PickerDraft, pending: PendingChange): PickerDraft {
  if (pending.type === 'preset') return commitPreset(draft, pending.preset);
  if (pending.type === 'weekday') return commitWeekday(draft, pending.weekday);
  if (pending.type === 'monthDay') return commitMonthDay(draft, pending.monthDay);
  if (pending.type === 'yearMonth') return commitYearMonth(draft, pending.yearMonth);
  return commitYearDay(draft, pending.yearDay);
}

export function setCustomUntil(draft: PickerDraft, date: string, range: ScheduleRange): PickerDraft {
  if (!dateEligible(date, range)) return draft;
  return { ...draft, customUntil: date };
}

/** Label for a repeat rule that has not been turned into a custom date list. */
export function unmodifiedRepeatLabel(draft: PickerDraft, range: ScheduleRange): string | null {
  if (draft.preset == null || draft.preset === 'manual' || draft.preset === 'once' || isCustomized(draft, range)) return null;
  if (!hasOccurrence(draft, range)) return null;
  const name = compactScheduleLabel(canonicalText(draft));
  if (!name || name === 'No schedule') return null;
  if (!range.deadline) return `${name} · No end date`;
  return `${name} · Until ${prettyDate(range.deadline)}`;
}

export function selectionState(draft: PickerDraft, range: ScheduleRange): { label: string; error: string | null } {
  const repeatLabel = unmodifiedRepeatLabel(draft, range);
  if (repeatLabel) return { label: repeatLabel, error: null };
  const materialized = listedDates(draft, range);
  if (materialized === 'unbounded') return { label: 'Repeats with no end date', error: null };
  if (materialized === 'need-end') return { label: 'Pick an end date to keep these changes', error: NEED_END_DATE };
  if (materialized === 'over-limit') return { label: 'More than 2000 dates', error: TOO_MANY_DATES };
  if (materialized.length === 0) return { label: 'No schedule', error: null };
  const count = materialized.length;
  return { label: `${count} ${count === 1 ? 'date' : 'dates'} selected`, error: null };
}

export function scheduleTextFromDraft(draft: PickerDraft, range: ScheduleRange): { text: string } | { error: string } {
  if (draft.preset == null) return { text: '' };
  if (!isCustomized(draft, range)) {
    if (!hasOccurrence(draft, range)) return { text: '' };
    return { text: canonicalText(draft) };
  }
  const dates = listedDates(draft, range);
  if (dates === 'unbounded' || dates === 'need-end') return { error: NEED_END_DATE };
  if (dates === 'over-limit') return { error: TOO_MANY_DATES };
  if (dates.length === 0) return { text: '' };
  if (dates.length > CUSTOM_DATES_LIMIT) return { error: TOO_MANY_DATES };
  return { text: `custom:${dates.join(',')}` };
}

function canonicalText(draft: PickerDraft): string {
  if (draft.preset === 'daily') return 'daily';
  if (draft.preset === 'weekly') return `weekly:${WEEK[draft.weekday]}`;
  if (draft.preset === 'monthly') return `monthly:${draft.monthDay}`;
  if (draft.preset === 'yearly') {
    return `yearly:${String(draft.yearMonth).padStart(2, '0')}-${String(draft.yearDay).padStart(2, '0')}`;
  }
  if (draft.preset === 'once' && draft.onceDate) return `once:${draft.onceDate}`;
  return '';
}

function hasOccurrence(draft: PickerDraft, range: ScheduleRange): boolean {
  const end = range.deadline;
  if (!end) {
    if (draft.preset === 'once') return !!draft.onceDate && dateEligible(draft.onceDate, range);
    if (draft.preset === 'manual') return draft.added.some(date => dateEligible(date, range));
    return draft.preset != null;
  }
  if (range.start > end) return false;
  if (draft.preset === 'daily') return true;
  if (draft.preset === 'once') return !!draft.onceDate && dateEligible(draft.onceDate, range);
  if (draft.preset === 'manual') return draft.added.some(date => dateEligible(date, range));
  for (let cursor = range.start; cursor <= end; cursor = addDays(cursor, 1)) {
    if (matchesPreset(draft, cursor)) return true;
  }
  return false;
}

export function compactScheduleLabel(text: string): string {
  const draft = draftFromScheduleText(text);
  if (draft.preset === 'daily') return 'Daily';
  if (draft.preset === 'weekly') return `Every ${WEEK_FULL[draft.weekday]}`;
  if (draft.preset === 'monthly') return `Monthly on day ${draft.monthDay}`;
  if (draft.preset === 'yearly') return `Yearly on ${MONTH_FULL[draft.yearMonth - 1]} ${draft.yearDay}`;
  if (draft.preset === 'once' && draft.onceDate) return `Once on ${prettyDate(draft.onceDate)}`;
  if (draft.preset === 'manual') return compactCustomLabel(draft.added);
  return 'No schedule';
}

export function compactCustomLabel(dates: string[]): string {
  const clean = sortUnique(dates.filter(date => isRealCivilDate(date)));
  if (!clean.length) return 'Custom schedule · no dates';
  const span = clean.length === 1 ? prettyDate(clean[0]) : prettySpan(clean[0], clean[clean.length - 1]);
  return `Custom schedule · ${clean.length} ${clean.length === 1 ? 'date' : 'dates'} · ${span}`;
}

export function endForDisplay(draft: PickerDraft, range: ScheduleRange): string | null {
  return draft.customUntil ?? range.deadline;
}

function listedDates(draft: PickerDraft, range: ScheduleRange): string[] | 'unbounded' | 'need-end' | 'over-limit' {
  if (draft.preset === 'manual') {
    const end = draft.customUntil ?? range.deadline;
    const dates = draft.added.filter(date => dateEligible(date, range) && (!end || date <= end));
    return dates.length > CUSTOM_DATES_LIMIT ? 'over-limit' : dates;
  }
  if (draft.preset == null) return [];
  const end = activeEnd(draft, range);
  if (!end) {
    if (!isCustomized(draft, range)) return 'unbounded';
    return 'need-end';
  }
  const dates: string[] = [];
  for (let cursor = range.start; cursor && cursor <= end; cursor = addDays(cursor, 1)) {
    if (isDateSelected(draft, cursor, range)) dates.push(cursor);
    if (dates.length > CUSTOM_DATES_LIMIT) return 'over-limit';
  }
  return dates;
}

function activeEnd(draft: PickerDraft, range: ScheduleRange): string | null {
  if (draft.customUntil && (!range.deadline || draft.customUntil <= range.deadline)) return draft.customUntil;
  return range.deadline;
}

function matchesPreset(draft: PickerDraft, date: string): boolean {
  const parts = partsOf(date);
  if (!parts) return false;
  if (draft.preset === 'daily') return true;
  if (draft.preset === 'weekly') return weekdayIndex(date) === draft.weekday;
  if (draft.preset === 'monthly') return parts.day === Math.min(draft.monthDay, daysInMonth(parts.year, parts.month));
  if (draft.preset === 'yearly') {
    if (parts.month !== draft.yearMonth) return false;
    return parts.day === Math.min(draft.yearDay, daysInMonth(parts.year, parts.month));
  }
  return false;
}

function storedCivilDay(value?: string | null): string | null {
  const raw = String(value ?? '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (!match || !isRealCivilDate(match[1])) return null;
  if (!raw.includes('T') || /T00:00:00/.test(raw)) return match[1];
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const civil = `${date.getFullYear()}-${month}-${day}`;
  return isRealCivilDate(civil) ? civil : null;
}

function prettyDate(date: string): string {
  const parts = partsOf(date);
  if (!parts) return date;
  return `${MONTH_SHORT[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

function prettySpan(start: string, end: string): string {
  const a = partsOf(start);
  const b = partsOf(end);
  if (!a || !b) return `${start} – ${end}`;
  if (a.year === b.year) return `${MONTH_SHORT[a.month - 1]} ${a.day} – ${MONTH_SHORT[b.month - 1]} ${b.day}`;
  return `${prettyDate(start)} – ${prettyDate(end)}`;
}

function partsOf(date: string): { year: number; month: number; day: number } | null {
  if (!isRealCivilDate(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function weekdayIndex(date: string): number {
  const parts = partsOf(date);
  if (!parts) return -1;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(date: string, days: number): string {
  const parts = partsOf(date);
  if (!parts) return date;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)).toISOString().slice(0, 10);
}

function sortUnique(dates: string[]): string[] {
  return [...new Set(dates)].sort();
}

function without(dates: string[], date: string): string[] {
  return dates.filter(item => item !== date);
}

function toggleList(dates: string[], date: string): string[] {
  return dates.includes(date) ? without(dates, date) : sortUnique([...dates, date]);
}

function isWeekday(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

function isMonthDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31;
}

function isYearDay(month: unknown, day: unknown): boolean {
  if (typeof month !== 'number' || typeof day !== 'number') return false;
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= (MONTH_MAX[month - 1] ?? 0);
}
