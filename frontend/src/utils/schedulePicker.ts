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
  weekdays: number[];
  monthDay: number;
  monthDays: number[];
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
  | { type: 'weekday'; weekday: number; weekdays: number[] }
  | { type: 'monthDay'; monthDay: number; monthDays: number[] }
  | { type: 'yearMonth'; yearMonth: number }
  | { type: 'yearDay'; yearDay: number };

export function emptyDraft(): PickerDraft {
  return {
    preset: null,
    weekday: 1,
    weekdays: [1],
    monthDay: 15,
    monthDays: [15],
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
  const weekdays = parsed.repeatDays?.length ? parsed.repeatDays : isWeekday(parsed.repeatDay) ? [parsed.repeatDay] : [];
  if (repeat === 'weekly' && weekdays.length) return { ...base, preset: 'weekly', weekday: weekdays[0], weekdays };
  const monthDays = parsed.repeatDays?.length ? parsed.repeatDays : isMonthDay(parsed.repeatDay) ? [parsed.repeatDay] : [];
  if (repeat === 'monthly' && monthDays.length) return { ...base, preset: 'monthly', monthDay: monthDays[0], monthDays };
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

function sameDays(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((day, index) => day === right[index]);
}

function toggledDays(current: number[], day: number): number[] {
  const next = current.includes(day) ? current.filter(item => item !== day) : [...current, day];
  next.sort((left, right) => left - right);
  return next;
}

export function requestWeekday(draft: PickerDraft, weekday: number, range: ScheduleRange): { draft: PickerDraft; confirm: boolean; weekdays: number[] } {
  const current = draft.preset === 'weekly' ? draft.weekdays : [];
  if (!isWeekday(weekday)) return { draft, confirm: false, weekdays: draft.weekdays };
  const next = toggledDays(current, weekday);
  if (!next.length || (draft.preset === 'weekly' && sameDays(current, next))) return { draft, confirm: false, weekdays: draft.weekdays };
  if (isCustomized(draft, range)) return { draft, confirm: true, weekdays: next };
  return { draft: commitWeekdays(draft, next), confirm: false, weekdays: next };
}

export function commitWeekday(draft: PickerDraft, weekday: number): PickerDraft {
  return commitWeekdays(draft, [weekday]);
}

export function commitWeekdays(draft: PickerDraft, weekdays: number[]): PickerDraft {
  const days = [...new Set(weekdays.filter(isWeekday))].sort((left, right) => left - right);
  return { ...commitPreset(draft, 'weekly'), weekday: days[0] ?? draft.weekday, weekdays: days.length ? days : draft.weekdays };
}

export function requestMonthDay(draft: PickerDraft, monthDay: number, range: ScheduleRange): { draft: PickerDraft; confirm: boolean; monthDays: number[] } {
  const current = draft.preset === 'monthly' ? draft.monthDays : [];
  if (!isMonthDay(monthDay)) return { draft, confirm: false, monthDays: draft.monthDays };
  const next = toggledDays(current, monthDay);
  if (!next.length || (draft.preset === 'monthly' && sameDays(current, next))) return { draft, confirm: false, monthDays: draft.monthDays };
  if (isCustomized(draft, range)) return { draft, confirm: true, monthDays: next };
  return { draft: commitMonthDays(draft, next), confirm: false, monthDays: next };
}

export function commitMonthDay(draft: PickerDraft, monthDay: number): PickerDraft {
  return commitMonthDays(draft, [monthDay]);
}

export function commitMonthDays(draft: PickerDraft, monthDays: number[]): PickerDraft {
  const days = [...new Set(monthDays.filter(isMonthDay))].sort((left, right) => left - right);
  return { ...commitPreset(draft, 'monthly'), monthDay: days[0] ?? draft.monthDay, monthDays: days.length ? days : draft.monthDays };
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
  if (pending.type === 'weekday') return commitWeekdays(draft, pending.weekdays);
  if (pending.type === 'monthDay') return commitMonthDays(draft, pending.monthDays);
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

function activeWeekdays(draft: PickerDraft): number[] {
  if (draft.weekdays.length === 1 && draft.weekday !== draft.weekdays[0] && isWeekday(draft.weekday)) return [draft.weekday];
  return draft.weekdays.length ? draft.weekdays : [draft.weekday];
}

function activeMonthDays(draft: PickerDraft): number[] {
  if (draft.monthDays.length === 1 && draft.monthDay !== draft.monthDays[0] && isMonthDay(draft.monthDay)) return [draft.monthDay];
  return draft.monthDays.length ? draft.monthDays : [draft.monthDay];
}

function canonicalText(draft: PickerDraft): string {
  if (draft.preset === 'daily') return 'daily';
  if (draft.preset === 'weekly') {
    const days = [...activeWeekdays(draft)].sort((left, right) => ((left + 6) % 7) - ((right + 6) % 7));
    return days.length ? `weekly:${days.map(day => WEEK[day]).join(',')}` : '';
  }
  if (draft.preset === 'monthly') {
    const days = [...activeMonthDays(draft)].sort((left, right) => left - right);
    return days.length ? `monthly:${days.join(',')}` : '';
  }
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
    if (draft.preset === 'weekly') return activeWeekdays(draft).length > 0;
    if (draft.preset === 'monthly') return activeMonthDays(draft).length > 0;
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
  if (draft.preset === 'weekly') {
    const days = [...activeWeekdays(draft)].sort((left, right) => ((left + 6) % 7) - ((right + 6) % 7));
    if (days.length === 1) return `Every ${WEEK_FULL[days[0]]}`;
    return days.length ? `Every ${days.map(day => WEEK[day]).join(', ')}` : 'Weekly';
  }
  if (draft.preset === 'monthly') {
    const days = [...activeMonthDays(draft)].sort((left, right) => left - right);
    if (days.length === 1) return `Monthly on day ${days[0]}`;
    return days.length ? `Monthly on days ${days.join(', ')}` : 'Monthly';
  }
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
  if (draft.preset === 'weekly') return activeWeekdays(draft).includes(weekdayIndex(date));
  if (draft.preset === 'monthly') {
    const days = activeMonthDays(draft);
    if (days.length <= 1) return parts.day === Math.min(days[0] ?? draft.monthDay, daysInMonth(parts.year, parts.month));
    return days.includes(parts.day);
  }
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
