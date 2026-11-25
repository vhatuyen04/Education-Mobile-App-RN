import type { GeneratedStepSchedule } from './aiSuggestion.js';
import {
  CUSTOM_DATES_LIMIT, civilToLocalDay, countRepeatOccurrencesBetween, isCalendarMonthDay, isRealCivilDate, isStepScheduledOnCivilDay, utcCivilDate,
} from './recurrenceSchedule.js';

const weekdays = [
  'sun(?:day)?', 'mon(?:day)?', 'tue(?:s(?:day)?)?', 'wed(?:nesday)?',
  'thu(?:rs?(?:day)?)?', 'fri(?:day)?', 'sat(?:urday)?',
];
const weekdayName = String.raw`(?:${weekdays.join('|')})s?\b`;
const weekdayList = String.raw`${weekdayName}(?:\s*(?:,\s*(?:and\s+)?|\band\s+)(?:(?:every|on)\s+)?${weekdayName})*`;
const allDays = [0, 1, 2, 3, 4, 5, 6];
const smallNumbers = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const ordinals = 'first second third fourth fifth sixth seventh eighth ninth tenth'.split(' ');
const months = 'january february march april may june july august september october november december'.split(' ');
const monthName = String.raw`(?:${months.flatMap(month => [month, month.slice(0, 3)]).join('|')}|sept)\b`;
const ordinalDay = String.raw`\d{1,2}(?:st|nd|rd|th)?\b`;
const annualDay = String.raw`(${monthName})\s+(${ordinalDay})`;

type ScheduleIntent =
  | { kind: 'nonrecurring' }
  | { kind: 'native'; schedule: GeneratedStepSchedule }
  | { kind: 'cadence'; repeat: 'weekly' | 'monthly' | 'yearly' }
  | { kind: 'dates'; dates: string[] }
  | { kind: 'weekdays'; days?: number[]; count?: number; restricted?: boolean }
  | { kind: 'invalid'; reason: 'interval' | 'date_list' | 'weekly_count' | 'weekday_expression' | 'conflicting_days' | 'calendar_day' };

export type Intent = ScheduleIntent & { offset: number };

/** Return an exact schedule only when the request supplies its parameters. */
export function requestedDirectSchedule(intent: Intent) {
  if (intent.kind === 'native') return intent.schedule;
  if (intent.kind === 'dates') {
    return intent.dates.length === 1 ? { type: 'once' as const, due: intent.dates[0] }
      : { type: 'repeat' as const, repeat: 'custom' as const, customDates: intent.dates };
  }
  if (intent.kind !== 'weekdays' || !intent.days?.length) return null;
  if (intent.days.length === 7) return { type: 'repeat' as const, repeat: 'daily' as const };
  if (intent.days.length === 1) return { type: 'repeat' as const, repeat: 'weekly' as const, repeatDay: intent.days[0] };
  return { type: 'weekdays' as const, days: intent.days };
}

function at(intent: ScheduleIntent, offset: number): Intent {
  return { ...intent, offset };
}

export function readWeekdays(text: string): number[] {
  return allDays.filter(day => new RegExp(String.raw`\b${weekdays[day]}s?\b`, 'i').test(text));
}

function monthNumber(month: string): number {
  return months.findIndex(name => name.startsWith(month.toLowerCase())) + 1;
}

function civilDate(year: string, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function readDateList(text: string): string[] | null {
  const iso = String.raw`\d{4}-\d{2}-\d{2}\b`;
  const named = String.raw`(?:${monthName}\s+${ordinalDay}|${ordinalDay}\s+${monthName})(?:(?:\s*,\s*|\s+)\d{4}\b)?`;
  const item = String.raw`(?:${iso}|${named})`;
  const list = new RegExp(String.raw`^${item}(?:\s*(?:,\s*(?:and\s+)?|\band\s+)${item})*`, 'i').exec(text)?.[0];
  if (!list || new RegExp(String.raw`^\s*(?:or\b|through\b|to\b|(?:,\s*(?:and\s+)?|and\s+)(?:\d|${monthName}))`, 'i').test(text.slice(list.length))) return null;
  const entries = list.match(new RegExp(item, 'gi')) ?? [];
  const years = new Set(entries.flatMap(entry => entry.match(/\b\d{4}\b/g) ?? []));
  const [sharedYear] = years;
  const dates = entries.map(entry => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(entry)) return entry;
    const year = entry.match(/\b\d{4}\b/)?.[0] ?? (years.size === 1 ? sharedYear : '');
    const name = entry.match(new RegExp(monthName, 'i'))?.[0] ?? '';
    const day = Number.parseInt(entry.match(new RegExp(String.raw`\b${ordinalDay}`, 'i'))?.[0] ?? '', 10);
    return civilDate(year, monthNumber(name), day);
  });
  if (!dates.every(isRealCivilDate) || new Set(dates).size !== dates.length) return null;
  return dates.sort();
}

export function readScheduleIntent(prompt: string, source: 'request' | 'step' = 'request'): Intent | null {
  const noRoutine = /\b(?:no\s+|without\s+(?:a\s+)?)(?:fixed|regular|recurring|set)\s+(?:routine|schedule)\b/i.exec(prompt);
  if (noRoutine) return at({ kind: 'nonrecurring' }, noRoutine.index);
  const unscheduled = /\b(?:no schedule|without (?:a )?schedule|leave (?:it|the step) unscheduled)\b/i.exec(prompt);
  if (unscheduled) {
    return at({ kind: 'native', schedule: { type: 'none' } }, unscheduled.index);
  }

  const unsupported = /\b(?:every other|alternate|every \d+)\s+(?:days?|weeks?|months?|years?)\b/i.exec(prompt);
  if (unsupported) return at({ kind: 'invalid', reason: 'interval' }, unsupported.index);
  const finite = /\b(only|once)\s+on\s+([^\n;]+)/i.exec(prompt);
  const onlyWeekdays = finite?.[1].toLowerCase() === 'only' && new RegExp(`^${weekdayName}`, 'i').test(finite[2]);
  if (finite && !onlyWeekdays) {
    const dates = readDateList(finite[2]);
    if (!dates || (finite[1].toLowerCase() === 'once' && dates.length !== 1)) return at({ kind: 'invalid', reason: 'date_list' }, finite.index);
    return at({ kind: 'dates', dates }, finite.index);
  }

  // In generated prose a noun can precede "sessions every week" without specifying a count.
  const quantityWord = source === 'request' ? '[a-z]+' : smallNumbers.join('|') + '|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand';
  const frequency = new RegExp(String.raw`\b(?:(\d+|${quantityWord})\s+(?:times?|sessions?|days?)|(once|twice))\s+(?:weekly|(?:per|a|each|every)\s+week)\b`, 'i').exec(prompt);
  const count = frequency?.[2] ? (frequency[2].toLowerCase() === 'twice' ? 2 : 1)
    : frequency ? Number(frequency[1]) || smallNumbers.indexOf(frequency[1].toLowerCase()) : undefined;
  if (frequency && (count === undefined || count < 1 || count > 7)) return at({ kind: 'invalid', reason: 'weekly_count' }, frequency.index);

  const selected = new RegExp(String.raw`\b(?:every|each|on)\s+(${weekdayList})`, 'i').exec(prompt);
  const excluded = new RegExp(String.raw`\b(?:except(?:\s+on)?|excluding|other than)\s+(${weekdayList})`, 'i').exec(prompt);
  const daily = /\b(?:daily|every day|each day)\b/i.exec(prompt);
  const workweek = /\b(?:on weekdays|every weekday|each weekday)\b/i.exec(prompt);
  const hasExclusion = /\b(?:except|excluding|other than)\b/i.test(prompt);
  if (daily || workweek || selected || count !== undefined) {
    const offset = Math.min(...[daily, workweek, selected, frequency, onlyWeekdays ? finite : null]
      .flatMap(match => match ? [match.index] : []));
    if ((hasExclusion && !excluded) || [selected, excluded].some(match =>
      match && new RegExp(String.raw`^\s*(?:or\b|(?:through\s+|to\s+|[-–—]\s*)${weekdayName})`, 'i').test(prompt.slice(match.index + match[0].length)))) {
      return at({ kind: 'invalid', reason: 'weekday_expression' }, offset);
    }
    const base = selected ? readWeekdays(selected[1]) : workweek ? [1, 2, 3, 4, 5] : daily ? allDays : undefined;
    const omitted = excluded ? readWeekdays(excluded[1]) : [];
    if (!base && omitted.length) {
      const eligible = allDays.filter(day => !omitted.includes(day));
      if (count === undefined || count !== eligible.length) return at({ kind: 'invalid', reason: 'conflicting_days' }, offset);
      return at({ kind: 'weekdays', days: eligible, count, restricted: true }, offset);
    }
    const days = base?.filter(day => !omitted.includes(day));
    if (days && (!days.length || (count !== undefined && days.length !== count))) return at({ kind: 'invalid', reason: 'conflicting_days' }, offset);
    return at({ kind: 'weekdays', days, count, restricted: omitted.length > 0 || onlyWeekdays }, offset);
  }

  const monthFirst = new RegExp(String.raw`\b(?:every|each|(?:yearly|annually)\s+(?:on\s+)?)\s*${annualDay}`, 'i').exec(prompt);
  const dayFirst = new RegExp(String.raw`\b(?:yearly|annually)\s+on\s+(${ordinalDay})\s+(${monthName})`, 'i').exec(prompt);
  const yearly = monthFirst ?? dayFirst;
  if (yearly) {
    const repeatMonth = monthNumber(yearly[monthFirst ? 1 : 2]);
    const repeatDay = Number.parseInt(yearly[monthFirst ? 2 : 1], 10);
    if (!isCalendarMonthDay(repeatMonth, repeatDay)) return at({ kind: 'invalid', reason: 'calendar_day' }, yearly.index);
    return at({ kind: 'native', schedule: { type: 'repeat', repeat: 'yearly', repeatMonth, repeatDay } }, yearly.index);
  }

  const dayOfMonth = String.raw`(${ordinalDay}|(?:${ordinals.join('|')})\b)`;
  const monthly = new RegExp(String.raw`\b(?:monthly|every month|each month)\s+on\s+(?:the\s+)?(?:day\s+)?${dayOfMonth}|\bon\s+(?:the\s+)?${dayOfMonth}\s+(?:day\s+)?of\s+(?:every|each|the)\s+month\b`, 'i').exec(prompt);
  if (monthly) {
    const raw = (monthly[1] ?? monthly[2]).toLowerCase();
    const repeatDay = Number.parseInt(raw, 10) || ordinals.indexOf(raw) + 1;
    if (repeatDay < 1 || repeatDay > 31) return at({ kind: 'invalid', reason: 'calendar_day' }, monthly.index);
    return at({ kind: 'native', schedule: { type: 'repeat', repeat: 'monthly', repeatDay } }, monthly.index);
  }
  const monthlyCadence = /\b(?:every|each)\s+month\b|\bmonthly\b[.!?]?\s*$/i.exec(prompt);
  const yearlyCadence = /\b(?:every|each)\s+year\b|\b(?:yearly|annually)\b[.!?]?\s*$/i.exec(prompt);
  const weeklyCadence = /\b(?:every|each)\s+week\b|\bweekly\b[.!?]?\s*$/i.exec(prompt);
  if (monthlyCadence) return at({ kind: 'cadence', repeat: 'monthly' }, monthlyCadence.index);
  if (yearlyCadence) return at({ kind: 'cadence', repeat: 'yearly' }, yearlyCadence.index);
  if (weeklyCadence) return at({ kind: 'cadence', repeat: 'weekly' }, weeklyCadence.index);
  return null;
}

export function startsWithScheduleListItem(text: string): boolean {
  return new RegExp(String.raw`^(?:(?:(?:every|on)\s+)?${weekdayName}|${monthName}\s+\d|\d{4}\b|\d{1,2}\s+${monthName})`, 'i').test(text);
}

export function weekdayDates(days: number[], today: string, deadline: string): string[] {
  if (!days.length) return [];
  const selected = new Set(days);
  const dates: string[] = [];
  const start = new Date(`${today}T00:00:00.000Z`);
  const end = new Date(`${deadline}T00:00:00.000Z`);
  for (const day = new Date(start); day <= end && dates.length <= CUSTOM_DATES_LIMIT; day.setUTCDate(day.getUTCDate() + 1)) {
    if (selected.has(day.getUTCDay())) dates.push(utcCivilDate(day));
  }
  return dates;
}

export function scheduleIntentError(
  intent: Intent,
  actual: GeneratedStepSchedule,
  today: string,
  deadline: string,
  selectedWeekdays?: number[],
): { rule: string; error: string } | null {
  const fail = (rule: string, error: string) => ({ rule, error });
  if (intent.kind === 'nonrecurring') return actual.type !== 'repeat' ? null : fail('no_recurrence', 'The request specifies no fixed routine. Use None or a one-time step.');
  const conflict = 'The AI plan did not follow the requested schedule. Try again or specify the schedule more explicitly.';
  if (intent.kind === 'invalid') return fail('supported_intent', 'The requested schedule is ambiguous or unsupported. Specify exact weekdays or dates.');
  if (intent.kind === 'cadence') {
    return actual.type === 'repeat' && actual.repeat === intent.repeat ? null : fail('cadence_matches', `Step 1 must use ${intent.repeat} recurrence.`);
  }
  if (intent.kind === 'native') {
    const expected = intent.schedule;
    return actual.type === expected.type &&
      (actual.type !== 'repeat' || (expected.type === 'repeat' && actual.repeat === expected.repeat &&
        actual.repeatDay === expected.repeatDay && actual.repeatMonth === expected.repeatMonth))
      ? null : fail('native_rule_matches', `Step 1 requires this schedule: ${JSON.stringify(expected)}.`);
  }

  const actualDates = datesForSchedule(actual);
  if (intent.kind === 'dates') {
    if (!sameDates(actualDates, intent.dates) || (intent.dates.length === 1 && actual.type !== 'once')) {
      return fail('exact_dates_match', `Step 1 must use exactly the requested date(s): ${intent.dates.join(', ')}.`);
    }
    return null;
  }

  const actualDays = selectedWeekdays ?? (actual.type === 'repeat' && actual.repeat === 'daily' ? allDays
    : actual.type === 'repeat' && actual.repeat === 'weekly' && actual.repeatDay !== undefined ? [actual.repeatDay]
      : [...new Set(actualDates.map(date => new Date(`${date}T00:00:00.000Z`).getUTCDay()))].sort());
  const weekdaysConflict = intent.days
    ? `Step 1 must use exactly weekday indices [${intent.days.join(', ')}] (0=Sunday, 6=Saturday).`
    : conflict;
  if (intent.days && selectedWeekdays && (intent.days.length !== selectedWeekdays.length ||
    !intent.days.every(day => selectedWeekdays.includes(day)))) return fail('weekday_selector_equals_requested', weekdaysConflict);
  const expectedDays = intent.days ?? actualDays;
  if (intent.count !== undefined && expectedDays.length !== intent.count) {
    return fail('weekday_count', `Step 1 requires ${intent.count} distinct days per week. The submitted schedule has ${expectedDays.length}. Use the supported weekday selector for multiple days.`);
  }
  const dates = weekdayDates(expectedDays, today, deadline);
  if (!dates.length) return fail('eligible_occurrence', 'The requested schedule has no dates inside the goal window.');
  if (expectedDays.length > 1 && expectedDays.length < 7 && dates.length > CUSTOM_DATES_LIMIT) {
    return fail('custom_date_limit', `The requested schedule exceeds ${CUSTOM_DATES_LIMIT} Custom Dates. Choose a shorter goal window.`);
  }
  if (expectedDays.length === 7) {
    if (actual.type !== 'repeat' || actual.repeat !== 'daily') return fail('daily_for_seven_days', weekdaysConflict);
  } else if (expectedDays.length === 1) {
    if (actual.type !== 'repeat' || actual.repeat !== 'weekly' || actual.repeatDay !== expectedDays[0]) return fail('weekly_day_matches', weekdaysConflict);
  } else if (actual.type !== 'repeat' || actual.repeat !== 'custom' || !sameDates(actualDates, dates)) {
    return fail('expanded_dates_equal_requested', weekdaysConflict);
  }
  return null;
}

function datesForSchedule(schedule: GeneratedStepSchedule): string[] {
  if (schedule.type === 'once') return [schedule.due];
  return schedule.type === 'repeat' && schedule.repeat === 'custom' ? schedule.customDates : [];
}

export function supportingScheduleError(intent: Intent, schedule: GeneratedStepSchedule, today: string, deadline: string): string | null {
  if (intent.kind === 'nonrecurring' && schedule.type === 'repeat') return 'Supporting work must respect the request for no recurrence.';
  if (schedule.type === 'none') return null;
  const weekdays = intent.kind === 'weekdays' && intent.restricted ? intent.days : undefined;
  if (!weekdays && intent.kind !== 'dates') return null;
  const conflict = 'A related step falls outside the requested dates or on an excluded weekday.';
  if (schedule.type === 'once' || schedule.repeat === 'custom') {
    const allowedDates = new Set(intent.kind === 'dates' ? intent.dates : []);
    const allowed = (date: string) => weekdays
      ? weekdays.includes(new Date(date + 'T00:00:00Z').getUTCDay()) : allowedDates.has(date);
    return datesForSchedule(schedule).every(allowed) ? null : conflict;
  }
  if (weekdays && schedule.repeat === 'weekly') {
    return schedule.repeatDay !== undefined && weekdays.includes(schedule.repeatDay) ? null : conflict;
  }
  // Count real occurrences so a native supporting recurrence can be a subset of an exact date list.
  const allowed = intent.kind === 'dates' ? intent.dates : weekdayDates(weekdays ?? [], today, deadline);
  const occurrences = countRepeatOccurrencesBetween(schedule, civilToLocalDay(today)!, civilToLocalDay(deadline)!);
  return allowed.filter(date => isStepScheduledOnCivilDay(schedule, date)).length === occurrences ? null : conflict;
}

function sameDates(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

export function primaryActionError(prompt: string, primary: { text: string; description?: string }): string | null {
  const title = primary.text.trim();
  if (!/\p{L}/u.test(title) || /^(?:daily|weekly|monthly|yearly|once|none)$/i.test(title)) {
    return 'The AI plan must include a step that directly performs the main activity.';
  }
  if (isAdministrativeStep(prompt, title, primary.description)) {
    return 'The AI plan needs a step that directly performs the main activity.';
  }
  const session = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*[- ]\s*(minutes?|hours?)\b/i.exec(prompt);
  if (session && !/\b(?:in|within|by)\s*$/i.test(prompt.slice(0, session.index))) {
    const duration = (amount: string, unit: string) =>
      (Number(amount) || smallNumbers.indexOf(amount.toLowerCase())) * (unit.toLowerCase().startsWith('hour') ? 60 : 1);
    const rendered = `${primary.text} ${primary.description ?? ''}`;
    const matches = [...rendered.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*[- ]\s*(minutes?|hours?)\b/gi)];
    if (!matches.some(match => duration(match[1], match[2]) === duration(session[1], session[2]))) {
      return `Step 1 must include the requested duration of ${session[1]} ${session[2]} in its title or description.`;
    }
  }
  return null;
}

function requestAction(prompt: string) {
  return prompt.trim().replace(/^(?:i\s+(?:want|need|would like)\s+to|i['’]d like to|my goal is to|(?:please\s+)?help me(?:\s+to)?|please)\s+/i, '');
}

export function requestsPlan(prompt: string): boolean {
  return /^(?:plan(?:ning)?\b(?!\s+(?:to|on)\b)|(?:make|create|write|draft|prepare|design|develop)\s+(?:(?:an?|the|my)\s+)?(?:[\w-]+\s+){0,3}plan\b)/i.test(requestAction(prompt));
}

export function isAdministrativeStep(prompt: string, title: string, description = ''): boolean {
  const administrative = /^(schedule|plan|set (?:a |up )?(?:reminders?|schedule)|track|choose|select)\b/i.exec(title.trim());
  const requestedAction = requestAction(prompt);
  const requestedVerb = requestedAction.match(/^\p{L}+/u)?.[0].toLowerCase();
  // "Track ..." may describe doing the requested work. A reminder alone still cannot fulfill it.
  if (administrative && /^(?:track|plan|choose|select)$/i.test(administrative[1]) &&
    requestedVerb && description.trim().match(/^\p{L}+/u)?.[0].toLowerCase() === requestedVerb) return false;
  return Boolean(administrative && requestedVerb !== administrative[1].split(' ')[0].toLowerCase() &&
    !(administrative[1].toLowerCase() === 'plan' && requestsPlan(prompt)));
}

export function duplicateActionError(steps: { text: string }[]): string | null {
  const titles = steps.map(step => step.text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
  return new Set(titles).size !== titles.length ? 'The AI plan contains duplicate steps.' : null;
}

export function hasActionableGoalWording(prompt: string): boolean {
  const request = /^(?:i\s+(?:want|need|would like)\s+to|my goal is to|help me(?: to)?)\s+\p{L}+\s+\p{L}+/iu;
  const action = /^(?:plan|learn|improve|become|build|practice|study|review|create|complete|finish|prepare|exercise|train|write|read|save|reduce|increase)\s+\p{L}+/iu;
  const text = prompt.trim().replace(/^please\s+/i, '');
  return request.test(text) || action.test(text);
}

export function stepFrequencyClaim(clause: string, planningDeliverable = false): Intent | null {
  // In a plan, "for each day" describes what the deliverable covers. "Work on it each day" schedules work.
  const text = (planningDeliverable ? clause.replace(/\bfor (?:each|every) day\b/gi, '') : clause).trim();
  // A frequency modifying an object ("compare daily totals") need not schedule the action.
  const actionText = text.replace(/\bdaily(?=\s+\p{L})/giu, (word, offset: number) => {
    const adverb = /^\s+(?:basis|for|until|through|to|at|with|and|except|excluding|other than)\b/i.test(text.slice(offset + word.length));
    return adverb || (!planningDeliverable && (!offset || /\b(?:in|of|a)\s+$/i.test(text.slice(0, offset)))) ? word : '';
  });
  const intent = readScheduleIntent(actionText, 'step');
  if (intent) return intent.kind === 'dates' ? null : intent;
  const cadence = /^(weekly|monthly|yearly)\b|\b(weekly|monthly|yearly)\s+(?:for|until|through)\b/i.exec(text);
  return cadence ? readScheduleIntent(cadence[1] ?? cadence[2]) : null;
}

/** Interpret only explicit goal horizons, leaving session lengths and deliverable attributes alone. */
export function generatedHorizonError(text: string, today: string, deadline: string, step: boolean, originalEnds: Set<string>): string | null {
  const date = String.raw`(?:\d{4}-\d{2}-\d{2}|(?:${annualDay}|${ordinalDay}\s+${monthName})(?:\s*,\s*|\s+)\d{4})\b`;
  const cue = String.raw`(?:(?<goal>\b(?:goal|plan)(?:\s+deadline)?|\bdeadline)\s*(?:is|of|ends|runs)?\s*[:=]?\s*)?(?<end>\bby|\buntil|\bthrough|\bbefore|\bon)?\s*`;
  for (const match of text.matchAll(new RegExp(cue + '(?<date>' + date + ')', 'gi'))) {
    const { goal, end, date: found } = match.groups!;
    if (!goal && (!end || end.toLowerCase() === 'on')) continue;
    const parsed = readDateList(found)?.[0];
    if (!parsed) return 'Use a real calendar date for the stated deadline.';
    const dateValue = new Date(parsed + 'T00:00:00Z');
    if (end?.toLowerCase() === 'before') dateValue.setUTCDate(dateValue.getUTCDate() - 1);
    const civil = utcCivilDate(dateValue);
    // A one-off task may be due before the goal ends.
    if (step && !goal && /^(?:by|before)$/i.test(end ?? '') && civil <= deadline) continue;
    if (civil !== deadline) return `Use the confirmed goal deadline ${deadline} in the generated wording.`;
  }
  for (const { end, planWide } of durationClaims(text, today)) {
    if (end !== deadline && (!step || planWide || originalEnds.has(end) || end > deadline)) {
      return `The stated plan duration does not end on ${deadline}. Express the plan horizon using the confirmed deadline.`;
    }
  }
  return null;
}

export function durationClaims(text: string, today: string) {
  const quantity = String.raw`(?<quantity>\d+|${smallNumbers.slice(1).join('|')})[\s-]+(?<unit>days?|weeks?|months?)\b`;
  const pattern = new RegExp(String.raw`\b(?<cue>for|over|within|in)\s+(?:(?:the\s+)?(?:next|same|full|entire)\s+)?${quantity}`, 'gi');
  const adjective = new RegExp(String.raw`\b${quantity}(?:\s+(?:long\s+)?(?:plan|goal|program|programme|period|routine|challenge)\b)`, 'gi');
  return [...text.matchAll(pattern), ...text.matchAll(adjective)].map(match => {
    const { quantity: n, unit, cue } = match.groups!;
    const count = /^\d+$/.test(n) ? Number(n) : smallNumbers.indexOf(n.toLowerCase());
    const date = new Date(today + 'T00:00:00Z');
    if (/^month/i.test(unit)) date.setUTCMonth(date.getUTCMonth() + count);
    else date.setUTCDate(date.getUTCDate() + count * (/^week/i.test(unit) ? 7 : 1));
    return { end: Number.isFinite(date.getTime()) ? utcCivilDate(date) : '', planWide: !cue };
  });
}
