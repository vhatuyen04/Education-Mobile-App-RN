import assert from 'node:assert/strict';
import test from 'node:test';

import { shiftMonth, pageOccurrences, classifyDate, monthDays } from '../src/utils/stepOccurrences.ts';
import {
  customDatesSummary,
  customDatesText,
  isCustomDateDisabled,
  parseScheduleShortText,
  scheduleDraftError,
  scheduleToShortText,
  stepOutsideActiveRangeError,
  toggleCustomDate,
} from '../src/utils/stepSchedule.ts';

test('selecting, clearing, and moving months keeps explicit dates', () => {
  let dates = toggleCustomDate([], '2026-11-23');
  dates = toggleCustomDate(dates, '2026-12-01');
  assert.deepEqual(dates, ['2026-11-23', '2026-12-01']);
  dates = toggleCustomDate(dates, '2026-11-23');
  assert.deepEqual(dates, ['2026-12-01']);
  assert.deepEqual(shiftMonth(2026, 11, 1), { year: 2026, month: 12 });
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.equal(customDatesText(dates), 'custom:2026-12-01');
  assert.equal(customDatesSummary(['2026-12-01', '2026-11-30']), 'Custom schedule · 2 dates · 2026-11-30 – 2026-12-01');
  assert.match(scheduleDraftError('custom:') ?? '', /at least one date/);
  assert.match(scheduleDraftError('custom:2026-11-23,2026-11-23') ?? '', /only once/);
  assert.match(scheduleDraftError('custom:2026-02-31') ?? '', /real calendar date/);
  assert.equal(scheduleDraftError('custom:2028-02-29'), null);
  assert.equal(parseScheduleShortText('daily').repeat, 'daily');
  assert.equal(scheduleToShortText({ dueAt: null, repeat: 'weekly', repeatDay: 1, repeatMonth: null }), 'weekly:Mon');
});

test('disabled dates stay outside today through the deadline', () => {
  assert.equal(isCustomDateDisabled('2026-11-22', '2026-11-23', '2026-11-30'), true);
  assert.equal(isCustomDateDisabled('2026-12-01', '2026-11-23', '2026-11-30'), true);
  assert.equal(isCustomDateDisabled('2026-11-23', '2026-11-23', '2026-11-30'), false);
  assert.equal(isCustomDateDisabled('2026-11-30', '2026-11-23', '2026-11-30'), false);
  assert.equal(isCustomDateDisabled('2027-03-01', '2026-11-23', null), false);
  assert.match(stepOutsideActiveRangeError({ repeat: 'custom', customDates: ['2026-11-22'] }, '2026-11-30T00:00:00.000Z', '2026-11-23') ?? '', /through 2026-11-30/);
  assert.equal(stepOutsideActiveRangeError({ repeat: 'custom', customDates: ['2026-11-30'] }, '2026-11-30T00:00:00.000Z', '2026-11-23'), null);
});

test('history and upcoming page selected dates and skip the gaps', () => {
  const dates = Array.from({ length: 80 }, (_, index) => {
    const day = new Date(Date.UTC(2026, 10, 23 + index));
    return day.toISOString().slice(0, 10);
  });
  const step = { repeat: 'custom', customDates: dates };
  const window = { start: '2026-11-23', end: '2027-02-28', today: '2026-11-23', archived: false, done: new Set(['2026-11-23']) };
  assert.equal(classifyDate(step, window, '2026-11-23'), 'DONE');
  assert.equal(classifyDate(step, window, '2026-11-24'), 'FUTURE');
  assert.equal(classifyDate(step, window, '2026-11-25'), 'FUTURE');
  assert.equal(classifyDate({ repeat: 'custom', customDates: ['2026-11-23'] }, window, '2026-11-24'), null);
  const month = monthDays(step, window, 2026, 11);
  assert.equal(month.find(day => day.date === '2026-11-22')?.status, null);
  assert.equal(month.find(day => day.date === '2026-11-23')?.status, 'DONE');
  assert.equal(month.find(day => day.date === '2026-11-30')?.status, 'FUTURE');
  const first = pageOccurrences({ step, window, direction: 'upcoming', limit: 40 });
  assert.equal(first.items.length, 40);
  assert.equal(first.hasMore, true);
  assert.equal(first.items[0]?.date, '2026-11-24');
  const second = pageOccurrences({ step, window, direction: 'upcoming', limit: 40, cursor: first.items.at(-1)?.date });
  assert.equal(second.items[0]?.date, '2027-01-03');
  assert.equal(second.items.length, 39);
  assert.equal(second.hasMore, false);
  const history = pageOccurrences({
    step,
    window: { ...window, today: '2027-02-20', done: new Set<string>() },
    direction: 'history',
    limit: 40,
  });
  assert.equal(history.items.length, 40);
  assert.equal(history.hasMore, true);
  assert.equal(history.items.every(item => item.status === 'MISSED'), true);
});
