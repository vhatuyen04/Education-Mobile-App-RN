import { deviceCivilDate, realCivilDate } from '../utils/recurrence';

const monthNames = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const monthNumbers = new Map(monthNames.flatMap((name, index) => [
  [name, index + 1] as const,
  [name.slice(0, 3), index + 1] as const,
]));
monthNumbers.set('sept', 9);

const month = [...monthNumbers.keys()].sort((a, b) => b.length - a.length).join('|');
const day = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
const monthFirst = String.raw`(${month})\s+(${day})(?:\s*,\s*|\s+)(\d{4})`;
const dayFirst = String.raw`(${day})\s+(${month})(?:\s*,\s*|\s+)(\d{4})`;
const numeric = String.raw`\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}`;
const calendarDate = String.raw`(?:${monthFirst}|${dayFirst}|${numeric})\b`;
const goalDeadlineCue = String.raw`\bgoal\s+deadline|(?:^|[.!?;]\s*)\s*deadline|\b(?:my|the)\s+deadline`;
const completionCue = String.raw`\b(?:finish|complete)(?:\s+(?:it|(?:the|this|my)\s+(?:goal|plan)))?\s+(?:by|before)`;
const endCue = String.raw`\b(?:goal|plan)\s+(?:(?:runs|lasts)\s+)?(?:until|through)\b|^\s*(?:by|before|until|through)\b`;

type PlannerDeadline =
  | { kind: 'resolved'; civil: string; dueAt: string }
  | { kind: 'missing' | 'invalid' | 'past' | 'ambiguous' };
type Resolved = Extract<PlannerDeadline, { kind: 'resolved' }>;
type DeadlineConflict = { kind: 'conflict'; plan: Resolved; field: Resolved };

function civilFromParts(year: string, monthNumber: number, dayText: string): string | null {
  const value = Number.parseInt(dayText, 10);
  const suffix = dayText.match(/[a-z]+$/)?.[0];
  const expected = value % 100 >= 11 && value % 100 <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] ?? 'th';
  if (suffix && suffix !== expected) return null;
  return realCivilDate(`${year}-${String(monthNumber).padStart(2, '0')}-${String(value).padStart(2, '0')}`);
}

function parseCalendarDate(value: string): string | null {
  const text = value.toLowerCase();
  const monthThenDay = new RegExp(`^${monthFirst}$`).exec(text);
  if (monthThenDay) {
    const [, name, dayText, year] = monthThenDay;
    return civilFromParts(year, monthNumbers.get(name)!, dayText);
  }
  const dayThenMonth = new RegExp(`^${dayFirst}$`).exec(text);
  if (dayThenMonth) {
    const [, dayText, name, year] = dayThenMonth;
    return civilFromParts(year, monthNumbers.get(name)!, dayText);
  }
  // Slash-separated dates use US month/day/year. Dotted and hyphenated day-first dates keep their existing meaning.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return civilFromParts(us[3], Number(us[1]), us[2]);
  if (text.includes('/')) return null;
  return realCivilDate(text);
}

function previousCivilDay(civil: string): string {
  const day = new Date(`${civil}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

function explicitDates(plan: string): (string | null)[] {
  const cue = new RegExp(String.raw`(?:${goalDeadlineCue})(?:\s+(?:is|of|on))?\s*[:=]?\s*(?:\b(?:by|before)\b)?|(?:${completionCue}|${endCue})|(?<inlineEnd>\b(?:until|through|by)\b)`, 'gi');
  const dateAtStart = new RegExp(`^\\s*(${calendarDate})`, 'i');
  const alternative = /^\s*(?:or\b|\/\s+|–|—|to\b)/i;
  const dates: (string | null)[] = [];
  const bareBy: (string | null)[] = [];
  for (const match of plan.matchAll(cue)) {
    let tail = plan.slice(match.index + match[0].length);
    let date = dateAtStart.exec(tail);
    const candidates: string[] = [];
    while (date) {
      candidates.push(date[1]);
      tail = tail.slice(date[0].length);
      const separator = alternative.exec(tail);
      date = separator ? dateAtStart.exec(tail.slice(separator[0].length)) : null;
      if (date && separator) tail = tail.slice(separator[0].length);
    }
    if (match.groups?.inlineEnd) {
      // A bare ending date must close the activity clause. Ignore labeled steps and delayed-start instructions.
      const clause = plan.slice(0, match.index).split(/[.!?;\n]/).at(-1)?.trim() ?? '';
      const stepClause = /^(?:for\s+)?(?:step|task|milestone)\s*#?\d+\b/i.test(clause);
      const delayedStart = /^(?:(?:i|we)\s+(?:(?:will|should|must)\s+)?)?(?:wait\b|hold off\b|(?:do not|don['’]t)\s+(?:start|begin)\b)/i.test(clause);
      if (stepClause || delayedStart || !/^\s*(?:$|[.!?;](?:\s|$))/.test(tail)) continue;
      if (match.groups.inlineEnd.toLowerCase() === 'by' && new RegExp(calendarDate, 'i').test(clause)) continue;
    }
    const exclusive = /\bbefore$/i.test(match[0].trim());
    for (const text of candidates) {
      const civil = parseCalendarDate(text);
      const target = match.groups?.inlineEnd?.toLowerCase() === 'by' ? bareBy : dates;
      target.push(civil && exclusive ? previousCivilDay(civil) : civil);
    }
  }
  return dates.length ? dates : bareBy;
}

const durationWords = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const quantityPattern = String.raw`(?:\d+|${durationWords.join('|')})`;
const unitPattern = 'days?|weeks?|months?';
const rangeStart = String.raw`${quantityPattern}(?:\s+(?:${unitPattern}))?`;
const relativeRange = new RegExp(String.raw`\b(?:${rangeStart}\s*(?:\bto\b|\bthrough\b|[-–—])\s*${quantityPattern}|between\s+${rangeStart}\s+and\s+${quantityPattern})\s+(?:${unitPattern})\b`, 'i');

function relativeDates(plan: string, now: Date): string[] {
  const qualified = [...plan.matchAll(new RegExp(String.raw`\b(?:in|within|for|over)\s+(?:(?:the\s+)?(?:next|same)\s+)?(${quantityPattern})\s*(${unitPattern})\b`, 'gi'))];
  const fallback = new RegExp(String.raw`(?:^\s*|\b(?:the next|duration\s*:)\s*)(${quantityPattern})\s+(${unitPattern})\b(?=\s*(?:$|[.!?;,]))|\b(\d+)[- ](day|week|month)\s+(?:goal|plan)\b`, 'gi');
  const matches = qualified.length ? qualified : [...plan.matchAll(fallback)].map(match => [match[0], match[1] ?? match[3], match[2] ?? match[4]]);
  return matches.map(([, quantity, unit]) => {
    const count = /^\d+$/.test(quantity) ? Number(quantity) : durationWords.indexOf(quantity.toLowerCase());
    if (!Number.isSafeInteger(count) || count <= 0) return '';
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    const lower = unit.toLowerCase();
    if (lower.startsWith('month')) date.setMonth(date.getMonth() + count);
    else date.setDate(date.getDate() + count * (lower.startsWith('week') ? 7 : 1));
    return Number.isFinite(date.getTime()) ? realCivilDate(deviceCivilDate(date)) ?? '' : '';
  });
}

function resolveDates(dates: (string | null)[], now: Date): PlannerDeadline {
  if (dates.length === 0) return { kind: 'missing' };
  const [civil] = dates;
  if (!civil || dates.some(date => !date)) return { kind: 'invalid' };
  if (dates.some(date => date !== civil)) return { kind: 'ambiguous' };
  if (civil < deviceCivilDate(now)) return { kind: 'past' };
  const [year, monthNumber, dayNumber] = civil.split('-').map(Number);
  const date = new Date(year, monthNumber - 1, dayNumber, 23, 59, 59, 999);
  return { kind: 'resolved', civil, dueAt: date.toISOString() };
}

export function resolvePlannerDeadline(planText: '', field: string, now?: Date): PlannerDeadline;
export function resolvePlannerDeadline(planText: string, field: string, now?: Date): PlannerDeadline | DeadlineConflict;
export function resolvePlannerDeadline(planText: string, field: string, now = new Date()): PlannerDeadline | DeadlineConflict {
  const explicit = explicitDates(planText);
  const plan = !explicit.length && relativeRange.test(planText) ? { kind: 'ambiguous' as const }
    : resolveDates(explicit.length ? explicit : relativeDates(planText, now), now);
  if (!field.trim()) return plan;
  const selected = resolveDates([parseCalendarDate(field.trim())], now);
  if (selected.kind === 'resolved' && plan.kind === 'resolved' && selected.civil !== plan.civil) {
    return { kind: 'conflict', plan, field: selected };
  }
  return selected;
}

export async function choosePlannerDeadline(plan: string, field: string,
  choose: (conflict: DeadlineConflict) => Promise<'plan' | 'field' | null>, now = new Date()) {
  const result = resolvePlannerDeadline(plan, field, now);
  if (result.kind !== 'conflict') return result;
  const choice = await choose(result);
  return choice && result[choice];
}
