import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countRepeatOccurrencesBetween,
  expectedRepeatOccurrences,
  isDeterminateRepeat,
  isStepScheduledOnDay,
  scheduleWriteError,
} from '../src/goals/recurrenceSchedule.ts';

const monday = new Date(2026, 10, 16, 12, 0, 0, 0);
const sunday = new Date(2026, 10, 22, 12, 0, 0, 0);
const april30 = new Date(2026, 3, 30, 12, 0, 0, 0);
const april29 = new Date(2026, 3, 29, 12, 0, 0, 0);

test('weekday 1 is due on Monday and a missing weekday is not Sunday', () => {
  assert.equal(scheduleWriteError({ repeat: 'weekly', repeatDay: 1 }), null);
  assert.equal(isStepScheduledOnDay({ repeat: 'weekly', repeatDay: 1 }, monday), true);
  assert.equal(isStepScheduledOnDay({ repeat: 'weekly', repeatDay: 1 }, sunday), false);
  assert.equal(isStepScheduledOnDay({ repeat: 'weekly', repeatDay: 0 }, sunday), true);
  assert.equal(isStepScheduledOnDay({ repeat: 'weekly', repeatDay: null }, sunday), false);
  assert.equal(isStepScheduledOnDay({ repeat: 'weekly', repeatDay: null }, monday), false);
  assert.equal(isDeterminateRepeat({ repeat: 'weekly', repeatDay: null }), false);
  assert.match(scheduleWriteError({ repeat: 'weekly', repeatDay: null }) ?? '', /weekday/);
});

test('monthly day 31 uses the last day of a shorter month, and a missing day is not every day', () => {
  assert.equal(isStepScheduledOnDay({ repeat: 'monthly', repeatDay: 31 }, april30), true);
  assert.equal(isStepScheduledOnDay({ repeat: 'monthly', repeatDay: 31 }, april29), false);
  assert.equal(isStepScheduledOnDay({ repeat: 'monthly', repeatDay: null }, april30), false);
  assert.equal(
    countRepeatOccurrencesBetween(
      { repeat: 'monthly', repeatDay: 31 },
      new Date(2026, 0, 1),
      new Date(2026, 3, 30)
    ),
    4
  );
});

test('yearly recurrence accepts a real date and rejects an impossible one', () => {
  assert.equal(scheduleWriteError({ repeat: 'yearly', repeatMonth: 2, repeatDay: 29 }), null);
  assert.equal(scheduleWriteError({ repeat: 'yearly', repeatMonth: 2, repeatDay: 30 }), 'Yearly steps need a real month and day');
  assert.equal(isStepScheduledOnDay({ repeat: 'yearly', repeatMonth: 11, repeatDay: 22 }, sunday), true);
  assert.equal(isStepScheduledOnDay({ repeat: 'yearly', repeatMonth: null, repeatDay: null }, sunday), false);
  assert.equal(
    countRepeatOccurrencesBetween(
      { repeat: 'yearly', repeatMonth: 2, repeatDay: 29 },
      new Date(2027, 0, 1),
      new Date(2028, 11, 31)
    ),
    2
  );
});

test('daily recurrence stays inside the goal date range', () => {
  assert.equal(scheduleWriteError({ repeat: 'daily' }), null);
  assert.equal(isStepScheduledOnDay({ repeat: 'daily' }, monday), true);
  assert.equal(
    countRepeatOccurrencesBetween({ repeat: 'daily' }, new Date(2026, 10, 16), new Date(2026, 10, 22)),
    7
  );
  assert.equal(
    countRepeatOccurrencesBetween({ repeat: 'weekly', repeatDay: 1 }, new Date(2026, 10, 16), new Date(2026, 10, 22)),
    1
  );
  assert.equal(
    countRepeatOccurrencesBetween({ repeat: 'weekly', repeatDay: 1 }, new Date(2026, 10, 17), new Date(2026, 10, 22)),
    0
  );
});

test('a one-time step is due only on its date', () => {
  const dueAt = new Date(2026, 10, 22, 23, 59, 59, 999).toISOString();
  assert.equal(isStepScheduledOnDay({ dueAt, repeat: null }, sunday), true);
  assert.equal(isStepScheduledOnDay({ dueAt, repeat: null }, monday), false);
  assert.equal(scheduleWriteError({ dueAt, repeat: 'weekly', repeatDay: 1 }), 'A step cannot have both a due date and a repeat');
});

test('a legacy incomplete weekly row is left incomplete', () => {
  const legacy = { repeat: 'weekly', repeatDay: null, repeatMonth: null };
  assert.equal(isDeterminateRepeat(legacy), false);
  assert.equal(countRepeatOccurrencesBetween(legacy, new Date(2026, 10, 16), new Date(2026, 10, 28)), 0);
  assert.equal(isStepScheduledOnDay(legacy, monday), false);
  assert.equal(scheduleWriteError({ repeat: 'daily' }), null);
  assert.equal(scheduleWriteError({ dueAt: null, repeat: null }), null);
  assert.match(scheduleWriteError(legacy) ?? '', /weekday/);
});

test('daily counts calendar days across both DST transitions', () => {
  const springFrom = new Date(2026, 2, 28);
  const springTo = new Date(2026, 2, 30);
  const autumnFrom = new Date(2026, 9, 24);
  const autumnTo = new Date(2026, 9, 26);
  assert.equal(countRepeatOccurrencesBetween({ repeat: 'daily' }, springFrom, springTo), civilDays(springFrom, springTo));
  assert.equal(countRepeatOccurrencesBetween({ repeat: 'daily' }, autumnFrom, autumnTo), civilDays(autumnFrom, autumnTo));
  assert.equal(civilDays(springFrom, springTo), 3);
  assert.equal(civilDays(autumnFrom, autumnTo), 3);
  assert.equal(
    countRepeatOccurrencesBetween({ repeat: 'daily' }, new Date(2026, 2, 27), new Date(2026, 3, 1)),
    6
  );
});

test('a deadline with no matching day stays at zero expected occurrences', () => {
  const weekly = { repeat: 'weekly', repeatDay: 1 };
  const start = new Date(2026, 10, 17);
  const due = new Date(2026, 10, 20);
  assert.equal(countRepeatOccurrencesBetween(weekly, start, due), 0);
  assert.equal(expectedRepeatOccurrences(weekly, start, due), 0);
  assert.equal(expectedRepeatOccurrences(weekly, start, null), 100);
  assert.equal(expectedRepeatOccurrences({ repeat: 'weekly', repeatDay: null }, start, due), 0);
});

test('monthly days 29, 30, and 31 clamp, and unknown text is rejected', () => {
  const feb28 = new Date(2026, 1, 28);
  const feb27 = new Date(2026, 1, 27);
  const april29 = new Date(2026, 3, 29);
  const april30 = new Date(2026, 3, 30);
  const may31 = new Date(2026, 4, 31);
  for (const day of [29, 30, 31]) {
    assert.equal(isStepScheduledOnDay({ repeat: 'monthly', repeatDay: day }, feb28), true);
    assert.equal(isStepScheduledOnDay({ repeat: 'monthly', repeatDay: day }, feb27), false);
  }
  assert.equal(isStepScheduledOnDay({ repeat: 'monthly', repeatDay: 29 }, april29), true);
  assert.equal(isStepScheduledOnDay({ repeat: 'monthly', repeatDay: 30 }, april30), true);
  assert.equal(isStepScheduledOnDay({ repeat: 'monthly', repeatDay: 31 }, april30), true);
  assert.equal(isStepScheduledOnDay({ repeat: 'monthly', repeatDay: 31 }, april29), false);
  assert.equal(isStepScheduledOnDay({ repeat: 'monthly', repeatDay: 31 }, may31), true);
  assert.equal(scheduleWriteError({ repeat: 'hello' }), 'Use daily, weekly, monthly, yearly, or once');
  assert.equal(isDeterminateRepeat({ repeat: 'hello' }), false);
  assert.equal(countRepeatOccurrencesBetween({ repeat: 'hello' }, new Date(2026, 0, 1), new Date(2026, 11, 31)), 0);
  assert.equal(isStepScheduledOnDay({ repeat: 'yearly', repeatMonth: 2, repeatDay: 29 }, new Date(2027, 1, 28)), true);
  assert.equal(isStepScheduledOnDay({ repeat: 'yearly', repeatMonth: 2, repeatDay: 29 }, new Date(2028, 1, 29)), true);
  assert.equal(isStepScheduledOnDay({ repeat: 'yearly', repeatMonth: 2, repeatDay: 29 }, new Date(2028, 1, 28)), false);
});

function civilDays(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / 86400000) + 1;
}
