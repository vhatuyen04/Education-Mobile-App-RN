import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { schedulePhrase } from '../src/utils/stepLifecycle.ts';
import {
  NEED_END_DATE,
  TOO_MANY_DATES,
  applyPending,
  commitPreset,
  compactScheduleLabel,
  draftFromScheduleText,
  isDateSelected,
  requestMonthDay,
  requestPreset,
  requestWeekday,
  scheduleTextFromDraft,
  selectionState,
  setCustomUntil,
  toggleDate,
  type PickerDraft,
  type ScheduleRange,
} from '../src/utils/schedulePicker.ts';

const finite: ScheduleRange = { start: '2026-11-24', deadline: '2026-12-31' };
const open: ScheduleRange = { start: '2026-11-24', deadline: null };

function textOf(draft: PickerDraft, range: ScheduleRange): string {
  const result = scheduleTextFromDraft(draft, range);
  if ('error' in result) throw new Error(result.error);
  return result.text;
}

function selectedBetween(draft: PickerDraft, range: ScheduleRange, start: string, end: string): string[] {
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    if (isDateSelected(draft, cursor, range)) dates.push(cursor);
  }
  return dates;
}

test('the schedule picker opens from create and replace, outside the form', () => {
  const goal = readFileSync(new URL('../src/screens/GoalDetailScreen.tsx', import.meta.url), 'utf8');
  const step = readFileSync(new URL('../src/screens/StepDetailScreen.tsx', import.meta.url), 'utf8');
  for (const source of [goal, step]) {
    assert.match(source, /ScheduleField/);
    assert.match(source, /SchedulePickerModal/);
    assert.doesNotMatch(source, /StepScheduleField/);
    assert.doesNotMatch(source, /customDatesSummary/);
  }
  assert.match(goal, /These fields stay as entered/);
  assert.match(step, /These fields stay fixed after that/);
  assert.match(step, /visible=\{replaceOpen && !scheduleOpen\}/);
});

test('daily selects every eligible date and keeps the daily rule', () => {
  const draft = commitPreset(draftFromScheduleText(''), 'daily');
  assert.deepEqual(selectedBetween(draft, finite, '2026-11-24', '2026-11-27'), ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
  assert.equal(isDateSelected(draft, '2026-11-23', finite), false);
  assert.equal(isDateSelected(draft, '2027-01-01', finite), false);
  assert.equal(textOf(draft, finite), 'daily');
  assert.equal(compactScheduleLabel('daily'), 'Daily');
});

test('weekly selects the chosen weekday', () => {
  const draft = { ...commitPreset(draftFromScheduleText(''), 'weekly'), weekday: 1 };
  assert.deepEqual(selectedBetween(draft, finite, '2026-11-24', '2026-12-14'), ['2026-11-30', '2026-12-07', '2026-12-14']);
  assert.equal(textOf(draft, finite), 'weekly:Mon');
  assert.equal(compactScheduleLabel('weekly:Mon'), 'Every Monday');
});

test('monthly day 31 clamps to the last valid day', () => {
  const range: ScheduleRange = { start: '2026-11-24', deadline: '2027-02-28' };
  const draft = { ...commitPreset(draftFromScheduleText(''), 'monthly'), monthDay: 31 };
  assert.deepEqual(selectedBetween(draft, range, range.start, range.deadline!), ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  assert.equal(textOf(draft, range), 'monthly:31');
  assert.equal(compactScheduleLabel('monthly:15'), 'Monthly on day 15');
});

test('yearly February 29 clamps in non-leap years', () => {
  const range: ScheduleRange = { start: '2026-01-01', deadline: '2028-12-31' };
  const draft = { ...commitPreset(draftFromScheduleText(''), 'yearly'), yearMonth: 2, yearDay: 29 };
  assert.equal(isDateSelected(draft, '2026-02-28', range), true);
  assert.equal(isDateSelected(draft, '2027-02-28', range), true);
  assert.equal(isDateSelected(draft, '2028-02-29', range), true);
  assert.equal(isDateSelected(draft, '2026-02-27', range), false);
  assert.equal(textOf(draft, range), 'yearly:02-29');
  assert.equal(compactScheduleLabel('yearly:12-15'), 'Yearly on December 15');
});

test('once selects one date', () => {
  let draft = commitPreset(draftFromScheduleText(''), 'once');
  draft = toggleDate(draft, '2026-11-30', finite);
  draft = toggleDate(draft, '2026-12-01', finite);
  assert.equal(isDateSelected(draft, '2026-11-30', finite), false);
  assert.equal(isDateSelected(draft, '2026-12-01', finite), true);
  assert.equal(textOf(draft, finite), 'once:2026-12-01');
  assert.equal(compactScheduleLabel('once:2026-11-30'), 'Once on Nov 30, 2026');
});

test('manual selection toggles a date, and an empty choice stays unscheduled', () => {
  let draft = commitPreset(draftFromScheduleText(''), 'manual');
  draft = toggleDate(draft, '2026-11-24', finite);
  draft = toggleDate(draft, '2026-11-26', finite);
  draft = toggleDate(draft, '2026-11-24', finite);
  assert.deepEqual(selectedBetween(draft, finite, '2026-11-24', '2026-11-26'), ['2026-11-26']);
  assert.equal(textOf(draft, finite), 'custom:2026-11-26');
  assert.deepEqual(scheduleTextFromDraft(commitPreset(draftFromScheduleText(''), 'manual'), finite), { text: '' });
  assert.deepEqual(scheduleTextFromDraft(draftFromScheduleText(''), finite), { text: '' });
});

test('a repeat with no date in range is saved as no schedule', () => {
  const short: ScheduleRange = { start: '2026-11-24', deadline: '2026-11-26' };
  const monday = { ...commitPreset(draftFromScheduleText(''), 'weekly'), weekday: 1 };
  assert.equal(isDateSelected(monday, '2026-11-24', short), false);
  assert.deepEqual(scheduleTextFromDraft(monday, short), { text: '' });
  assert.equal(selectionState(monday, short).label, 'No schedule');
  const cleared = ['2026-11-24', '2026-11-25', '2026-11-26'].reduce(
    (next, date) => toggleDate(next, date, short),
    commitPreset(draftFromScheduleText(''), 'daily'),
  );
  assert.deepEqual(scheduleTextFromDraft(cleared, short), { text: '' });
  assert.equal(textOf({ ...commitPreset(draftFromScheduleText(''), 'weekly'), weekday: 1 }, open), 'weekly:Mon');
});

test('daily then unticking one date keeps the other dates', () => {
  let draft = commitPreset(draftFromScheduleText(''), 'daily');
  draft = toggleDate(draft, '2026-11-25', finite);
  assert.deepEqual(selectedBetween(draft, finite, '2026-11-24', '2026-11-27'), ['2026-11-24', '2026-11-26', '2026-11-27']);
  assert.equal(textOf(draft, finite).startsWith('custom:'), true);
  assert.equal(textOf(draft, finite).includes('2026-11-25'), false);
  assert.equal(textOf(draft, finite).includes('2026-11-24'), true);
});

test('weekly then unticking one Monday keeps the other Mondays', () => {
  let draft = { ...commitPreset(draftFromScheduleText(''), 'weekly'), weekday: 1 };
  draft = toggleDate(draft, '2026-11-30', finite);
  assert.equal(isDateSelected(draft, '2026-11-30', finite), false);
  assert.equal(isDateSelected(draft, '2026-12-07', finite), true);
  assert.equal(isDateSelected(draft, '2026-12-14', finite), true);
  assert.equal(textOf(draft, finite).includes('2026-11-30'), false);
});

test('monthly then adding a date keeps the monthly days', () => {
  let draft = { ...commitPreset(draftFromScheduleText(''), 'monthly'), monthDay: 15 };
  draft = toggleDate(draft, '2026-11-20', { start: '2026-11-01', deadline: '2027-01-31' });
  const range: ScheduleRange = { start: '2026-11-01', deadline: '2027-01-31' };
  assert.equal(isDateSelected(draft, '2026-11-15', range), true);
  assert.equal(isDateSelected(draft, '2026-11-20', range), true);
  assert.equal(isDateSelected(draft, '2026-12-15', range), true);
  assert.equal(textOf(draft, range).includes('2026-11-20'), true);
});

test('selections survive a different visible month', () => {
  let draft = commitPreset(draftFromScheduleText(''), 'manual');
  draft = toggleDate(draft, '2026-11-24', finite);
  draft = toggleDate(draft, '2026-12-31', finite);
  assert.equal(isDateSelected(draft, '2026-11-24', finite), true);
  assert.equal(isDateSelected(draft, '2026-12-31', finite), true);
  assert.equal(compactScheduleLabel(textOf(draft, finite)), 'Custom schedule · 2 dates · Nov 24 – Dec 31');
});

test('a different preset replaces the previous draft instead of merging it', () => {
  let draft = toggleDate(commitPreset(draftFromScheduleText(''), 'daily'), '2026-11-25', finite);
  const requested = requestPreset(draft, 'weekly', finite);
  assert.equal(requested.confirm, true);
  assert.equal(isDateSelected(requested.draft, '2026-11-24', finite), true);
  draft = applyPending(draft, { type: 'preset', preset: 'weekly' });
  assert.equal(isDateSelected(draft, '2026-11-25', finite), false);
  assert.equal(isDateSelected(draft, '2026-11-30', finite), true);
  assert.equal(textOf(draft, finite), 'weekly:Mon');
  const again = requestPreset(toggleDate(draftFromScheduleText('daily'), '2026-11-25', finite), 'daily', finite);
  assert.equal(again.confirm, true);
  assert.equal(textOf(applyPending(again.draft, { type: 'preset', preset: 'daily' }), finite), 'daily');
});

test('cancel discards the draft and confirm only returns schedule text', () => {
  const original = 'daily';
  const edited = toggleDate(draftFromScheduleText(original), '2026-11-25', finite);
  let saved = false;
  const confirm = () => {
    const result = scheduleTextFromDraft(edited, finite);
    if ('text' in result) return result.text;
    return original;
  };
  const cancel = () => original;
  assert.equal(cancel(), 'daily');
  assert.notEqual(confirm(), 'daily');
  assert.equal(saved, false);
});

test('an unchanged preset keeps its canonical recurrence', () => {
  const range = finite;
  assert.equal(textOf(draftFromScheduleText('daily'), range), 'daily');
  assert.equal(textOf(draftFromScheduleText('weekly:Mon'), range), 'weekly:Mon');
  assert.equal(textOf(draftFromScheduleText('monthly:15'), range), 'monthly:15');
  assert.equal(textOf(draftFromScheduleText('yearly:12-15'), range), 'yearly:12-15');
  assert.equal(textOf(draftFromScheduleText('once:2026-11-30'), range), 'once:2026-11-30');
});

test('a modified preset is stored as custom dates', () => {
  const draft = toggleDate(draftFromScheduleText('daily'), '2026-11-25', finite);
  const text = textOf(draft, finite);
  assert.match(text, /^custom:/);
  const reloaded = draftFromScheduleText(text);
  assert.equal(reloaded.preset, 'manual');
  assert.equal(isDateSelected(reloaded, '2026-11-25', finite), false);
  assert.equal(isDateSelected(reloaded, '2026-11-24', finite), true);
  assert.equal(schedulePhrase({ repeat: 'custom', customDates: ['2026-11-24', '2026-12-31'] }).includes(','), false);
});

test('goal deadline and same-day replacement bound the calendar', () => {
  const draft = commitPreset(draftFromScheduleText(''), 'daily');
  assert.equal(isDateSelected(draft, '2026-12-31', finite), true);
  assert.equal(toggleDate(draft, '2027-01-01', finite), draft);
  assert.equal(toggleDate(draft, '2026-11-23', finite), draft);
  assert.equal(isDateSelected(draft, '2026-11-24', finite), true);
});

test('an open-ended repeat stays a rule until the user sets a finite end', () => {
  const daily = commitPreset(draftFromScheduleText(''), 'daily');
  assert.equal(textOf(daily, open), 'daily');
  assert.equal(selectionState(daily, open).label, 'Daily · No end date');
  const edited = toggleDate(daily, '2026-11-25', open);
  assert.deepEqual(scheduleTextFromDraft(edited, open), { error: NEED_END_DATE });
  const bounded = setCustomUntil(edited, '2026-11-30', open);
  assert.deepEqual(selectedBetween(bounded, open, '2026-11-24', '2026-12-02'), ['2026-11-24', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30']);
  assert.equal(textOf(bounded, open).includes('2026-12-01'), false);
});

test('more than 2000 custom dates are rejected without truncation', () => {
  const range: ScheduleRange = { start: '2018-01-01', deadline: '2024-01-01' };
  assert.equal(textOf(commitPreset(draftFromScheduleText(''), 'daily'), range), 'daily');
  const edited = toggleDate(commitPreset(draftFromScheduleText(''), 'daily'), '2020-01-01', range);
  const result = scheduleTextFromDraft(edited, range);
  assert.deepEqual(result, { error: TOO_MANY_DATES });
  assert.equal('text' in result, false);
  assert.equal(selectionState(edited, range).label, 'More than 2000 dates');
  assert.equal(selectionState(edited, range).error, TOO_MANY_DATES);
});

test('an unmodified daily rule keeps its name past 2000 days', () => {
  const short: ScheduleRange = { start: '2026-11-24', deadline: '2026-12-31' };
  const long: ScheduleRange = { start: '2018-01-01', deadline: '2024-01-01' };
  const daily = commitPreset(draftFromScheduleText(''), 'daily');
  assert.equal(selectionState(daily, short).label, 'Daily · Until Dec 31, 2026');
  assert.equal(selectionState(daily, long).label, 'Daily · Until Jan 1, 2024');
  assert.equal(selectionState(daily, open).label, 'Daily · No end date');
  assert.equal(textOf(daily, long), 'daily');
  assert.equal(compactScheduleLabel(textOf(daily, long)), 'Daily');
  assert.equal(selectionState(daily, long).label.startsWith(compactScheduleLabel('daily')), true);
  assert.equal(selectionState(daily, long).error, null);
  assert.equal(compactScheduleLabel('weekly:Mon'), 'Every Monday');
  assert.equal(compactScheduleLabel('monthly:15'), 'Monthly on day 15');
  assert.equal(compactScheduleLabel('yearly:12-15'), 'Yearly on December 15');
  assert.equal(compactScheduleLabel('once:2026-11-30'), 'Once on Nov 30, 2026');
  assert.equal(compactScheduleLabel(''), 'No schedule');
  assert.equal(compactScheduleLabel('custom:2026-11-24,2026-12-31'), 'Custom schedule · 2 dates · Nov 24 – Dec 31');
});

test('weekly and monthly selection keeps several days on one rule', () => {
  const range: ScheduleRange = { start: '2026-01-01', deadline: '2026-04-30' };
  const week = requestWeekday(draftFromScheduleText('weekly:Mon'), 2, range).draft;
  assert.equal(textOf(week, range), 'weekly:Mon,Tue');
  assert.equal(compactScheduleLabel('weekly:Mon,Tue'), 'Every Mon, Tue');
  assert.equal(textOf(requestWeekday(week, 1, range).draft, range), 'weekly:Tue');
  assert.equal(textOf(requestWeekday(requestWeekday(week, 1, range).draft, 2, range).draft, range), 'weekly:Tue');

  const month = requestMonthDay(draftFromScheduleText('monthly:30'), 31, range).draft;
  assert.equal(textOf(month, range), 'monthly:30,31');
  assert.equal(compactScheduleLabel('monthly:30,31'), 'Monthly on days 30, 31');
  assert.deepEqual(selectedBetween(month, range, '2026-01-30', '2026-02-28'), ['2026-01-30', '2026-01-31']);
  assert.equal(isDateSelected(month, '2026-04-30', range), true);
  assert.equal(isDateSelected(month, '2026-04-29', range), false);
  assert.equal(isDateSelected(draftFromScheduleText('monthly:31'), '2026-02-28', range), true);
});

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
