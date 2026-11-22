import assert from 'node:assert/strict';
import test from 'node:test';

import { parseScheduleShortText, scheduleDraftError, storedScheduleError } from '../src/utils/stepSchedule.ts';

test('weekly:Mon is weekday 1 and bare weekly is rejected', () => {
  const parsed = parseScheduleShortText('weekly:Mon');
  assert.equal(parsed.repeat, 'weekly');
  assert.equal(parsed.repeatDay, 1);
  assert.equal(parsed.dueAt, null);
  assert.equal(scheduleDraftError('weekly:Mon'), null);
  assert.equal(scheduleDraftError('weekly:Sun'), null);
  assert.equal(parseScheduleShortText('weekly:Sun').repeatDay, 0);
  assert.equal(scheduleDraftError('weekly'), 'Use weekly:Mon (Sun–Sat)');
  assert.equal(storedScheduleError({ repeat: 'weekly', repeatDay: null }), 'Use weekly:Mon (Sun–Sat)');
});

test('monthly and yearly drafts follow the existing day rules', () => {
  assert.equal(scheduleDraftError('monthly:31'), null);
  assert.equal(scheduleDraftError('monthly'), 'Use monthly:1–31');
  assert.equal(scheduleDraftError('monthly:32'), 'Use monthly:1–31');
  assert.equal(parseScheduleShortText('yearly:02-29').repeatMonth, 2);
  assert.equal(parseScheduleShortText('yearly:02-29').repeatDay, 29);
  assert.equal(scheduleDraftError('yearly:02-29'), null);
  assert.equal(scheduleDraftError('yearly:02-30'), 'Use a real yearly:MM-DD');
  assert.equal(scheduleDraftError('yearly:04-31'), 'Use a real yearly:MM-DD');
  assert.equal(scheduleDraftError('yearly'), 'Use yearly:MM-DD');
});

test('daily and one-time drafts persist the existing fields', () => {
  assert.deepEqual(parseScheduleShortText('daily'), { dueAt: null, repeat: 'daily', repeatDay: null, repeatMonth: null });
  assert.equal(scheduleDraftError('daily'), null);
  const once = parseScheduleShortText('once:2026-11-22');
  assert.equal(once.repeat, null);
  const due = new Date(once.dueAt ?? '');
  assert.equal(due.getFullYear(), 2026);
  assert.equal(due.getMonth(), 10);
  assert.equal(due.getDate(), 22);
  assert.equal(scheduleDraftError('once:2026-11-22'), null);
  assert.equal(scheduleDraftError('once:2026-02-31'), 'Use a real once:YYYY-MM-DD');
  assert.equal(scheduleDraftError(''), null);
  assert.equal(scheduleDraftError('hello'), 'Use daily, weekly:Mon, monthly:1–31, yearly:MM-DD, or once:YYYY-MM-DD');
  assert.equal(scheduleDraftError('repeat:hourly'), 'Use daily, weekly:Mon, monthly:1–31, yearly:MM-DD, or once:YYYY-MM-DD');
  assert.equal(parseScheduleShortText('hello').repeat, null);
  assert.equal(storedScheduleError({ repeat: 'hello' }), 'Use daily, weekly:Mon, monthly:1–31, yearly:MM-DD, or once:YYYY-MM-DD');
  assert.equal(storedScheduleError({ repeat: 'weekly', repeatDay: null }), 'Use weekly:Mon (Sun–Sat)');
});
