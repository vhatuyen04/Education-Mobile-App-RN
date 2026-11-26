import assert from 'node:assert/strict';
import test from 'node:test';

import { parseScheduleShortText, scheduleDraftError, scheduleToShortText, storedScheduleError } from '../src/utils/stepSchedule.ts';

test('weekly:Mon is weekday 1 and bare weekly is rejected', () => {
  const parsed = parseScheduleShortText('weekly:Mon');
  assert.equal(parsed.repeat, 'weekly');
  assert.equal(parsed.repeatDay, 1);
  assert.equal(parsed.dueAt, null);
  assert.equal(scheduleDraftError('weekly:Mon'), null);
  assert.equal(scheduleDraftError('weekly:Sun'), null);
  assert.equal(parseScheduleShortText('weekly:Sun').repeatDay, 0);
  assert.equal(scheduleDraftError('weekly'), 'Pick a weekday from Monday through Sunday, such as weekly:Mon, and try again.');
  assert.equal(storedScheduleError({ repeat: 'weekly', repeatDay: null }), 'Pick a weekday from Monday through Sunday, such as weekly:Mon, and try again.');
});

test('monthly and yearly drafts follow the existing day rules', () => {
  assert.equal(scheduleDraftError('monthly:31'), null);
  assert.equal(scheduleDraftError('monthly'), 'Pick a day from 1 through 31, such as monthly:15, and try again.');
  assert.equal(scheduleDraftError('monthly:32'), 'Pick a day from 1 through 31, such as monthly:15, and try again.');
  assert.equal(parseScheduleShortText('yearly:02-29').repeatMonth, 2);
  assert.equal(parseScheduleShortText('yearly:02-29').repeatDay, 29);
  assert.equal(scheduleDraftError('yearly:02-29'), null);
  assert.equal(scheduleDraftError('yearly:02-30'), 'Pick a real month and day, such as yearly:02-29, and try again.');
  assert.equal(scheduleDraftError('yearly:04-31'), 'Pick a real month and day, such as yearly:02-29, and try again.');
  assert.equal(scheduleDraftError('yearly'), 'Pick a real month and day, such as yearly:02-29, and try again.');
});

test('daily and one-time drafts persist the existing fields', () => {
  assert.deepEqual(parseScheduleShortText('daily'), { dueAt: null, repeat: 'daily', repeatDay: null, repeatMonth: null });
  assert.equal(scheduleDraftError('daily'), null);
  const once = parseScheduleShortText('once:2026-11-22');
  assert.equal(once.repeat, null);
  const due = new Date(once.dueAt ?? '');
  assert.equal(due.toISOString(), '2026-11-22T00:00:00.000Z');
  assert.equal(due.getUTCFullYear(), 2026);
  assert.equal(due.getUTCMonth(), 10);
  assert.equal(due.getUTCDate(), 22);
  assert.equal(scheduleDraftError('once:2026-11-22'), null);
  assert.equal(scheduleDraftError('once:2026-02-31'), 'Pick a real date, such as once:2026-11-22, and try again.');
  assert.equal(scheduleDraftError('once'), 'Pick a real date, such as once:2026-11-22, and try again.');
  assert.equal(scheduleDraftError('daily:2'), 'Use daily by itself, with no extra text, and try again.');
  assert.equal(scheduleDraftError(''), null);
  assert.equal(scheduleDraftError('hello'), 'Use daily, weekly:Mon, monthly:15, yearly:02-29, or once:2026-11-22, and try again.');
  assert.equal(scheduleDraftError('repeat:hourly'), 'Use daily, weekly:Mon, monthly:15, yearly:02-29, or once:2026-11-22, and try again.');
  assert.equal(parseScheduleShortText('hello').repeat, null);
  assert.equal(storedScheduleError({ repeat: 'hello' }), 'Use daily, weekly:Mon, monthly:15, yearly:02-29, or once:2026-11-22, and try again.');
  assert.equal(storedScheduleError({ repeat: 'weekly', repeatDay: null }), 'Pick a weekday from Monday through Sunday, such as weekly:Mon, and try again.');
});

test('weekly and monthly text keeps every selected day', () => {
  const weekly = parseScheduleShortText('weekly:Mon,Tue');
  assert.equal(weekly.repeatDay, 1);
  assert.deepEqual(weekly.repeatDays, [1, 2]);
  assert.equal(scheduleDraftError('weekly:Mon,Tue'), null);
  assert.equal(scheduleDraftError('weekly:Mon,Mon'), 'Pick a weekday from Monday through Sunday, such as weekly:Mon, and try again.');
  assert.equal(scheduleToShortText({ dueAt: null, repeat: 'weekly', repeatDay: 1, repeatMonth: null, repeatDays: [1, 2] }), 'weekly:Mon,Tue');

  const monthly = parseScheduleShortText('monthly:30,31');
  assert.equal(monthly.repeatDay, 30);
  assert.deepEqual(monthly.repeatDays, [30, 31]);
  assert.equal(scheduleDraftError('monthly:30,31'), null);
  assert.equal(scheduleToShortText({ dueAt: null, repeat: 'monthly', repeatDay: 30, repeatMonth: null, repeatDays: [30, 31] }), 'monthly:30,31');
  assert.equal(scheduleToShortText({ dueAt: null, repeat: 'monthly', repeatDay: 31, repeatMonth: null }), 'monthly:31');
});
