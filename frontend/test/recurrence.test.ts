import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countRepeatOccurrencesUntilDeadline,
  deadlineError,
  deadlineRetryMessage,
  deviceCivilDate,
  localReminderInstant,
  nextReminderOccurrence,
  occurrenceIsOnOrBeforeGoalDue,
  realCivilDate,
} from '../src/utils/recurrence.ts';

test('a weekly reminder stays on today when that time has not passed', () => {
  const now = new Date(2026, 10, 16, 10, 0, 0, 0);
  assert.equal(now.getDay(), 1);
  const due = nextReminderOccurrence({ repeat: 'weekly', repeatDay: 1, now });
  assert.ok(due);
  assert.equal(due?.getFullYear(), 2026);
  assert.equal(due?.getMonth(), 10);
  assert.equal(due?.getDate(), 16);
  assert.equal(due?.getHours(), 23);

  const late = nextReminderOccurrence({ repeat: 'weekly', repeatDay: 1, now: new Date(2026, 10, 16, 23, 59, 59, 999) });
  assert.equal(late?.getDate(), 23);
});

test('monthly reminders use days 29, 30, and 31 without rolling into the next month', () => {
  const april = new Date(2026, 3, 1, 9, 0, 0, 0);
  const day29 = nextReminderOccurrence({ repeat: 'monthly', repeatDay: 29, now: april });
  const day30 = nextReminderOccurrence({ repeat: 'monthly', repeatDay: 30, now: april });
  const day31 = nextReminderOccurrence({ repeat: 'monthly', repeatDay: 31, now: april });
  assert.equal(day29?.getMonth(), 3);
  assert.equal(day29?.getDate(), 29);
  assert.equal(day30?.getMonth(), 3);
  assert.equal(day30?.getDate(), 30);
  assert.equal(day31?.getMonth(), 3);
  assert.equal(day31?.getDate(), 30);

  const february = nextReminderOccurrence({ repeat: 'monthly', repeatDay: 31, now: new Date(2026, 1, 1, 9, 0, 0, 0) });
  assert.equal(february?.getMonth(), 1);
  assert.equal(february?.getDate(), 28);

  const afterApril = nextReminderOccurrence({
    repeat: 'monthly',
    repeatDay: 31,
    now: april,
    goalDueAt: new Date(2026, 3, 15, 23, 59, 59, 999),
  });
  assert.equal(afterApril, null);
});

test('yearly February 29 uses the leap day and clamps a non-leap year', () => {
  const leap = nextReminderOccurrence({
    repeat: 'yearly',
    repeatMonth: 2,
    repeatDay: 29,
    now: new Date(2028, 0, 15, 9, 0, 0, 0),
  });
  assert.equal(leap?.getFullYear(), 2028);
  assert.equal(leap?.getMonth(), 1);
  assert.equal(leap?.getDate(), 29);

  const nonLeap = nextReminderOccurrence({
    repeat: 'yearly',
    repeatMonth: 2,
    repeatDay: 29,
    now: new Date(2027, 0, 15, 9, 0, 0, 0),
  });
  assert.equal(nonLeap?.getFullYear(), 2027);
  assert.equal(nonLeap?.getMonth(), 1);
  assert.equal(nonLeap?.getDate(), 28);
});

test('a reminder does not fire before the step exists or after the goal deadline', () => {
  const due = nextReminderOccurrence({
    repeat: 'daily',
    now: new Date(2026, 10, 1, 9, 0, 0, 0),
    notBeforeCivil: '2026-11-20',
    goalDueAt: '2026-11-30T00:00:00.000Z',
  });
  assert.equal(due?.getFullYear(), 2026);
  assert.equal(due?.getMonth(), 10);
  assert.equal(due?.getDate(), 20);

  const afterDeadline = nextReminderOccurrence({
    repeat: 'daily',
    now: new Date(2026, 10, 20, 9, 0, 0, 0),
    notBeforeCivil: '2026-12-01',
    goalDueAt: '2026-11-30T00:00:00.000Z',
  });
  assert.equal(afterDeadline, null);

  const once = localReminderInstant(new Date('2028-02-29T00:00:00.000Z'));
  assert.equal(once.getFullYear(), 2028);
  assert.equal(once.getMonth(), 1);
  assert.equal(once.getDate(), 29);
  assert.equal(once.getHours(), 23);
  assert.equal(occurrenceIsOnOrBeforeGoalDue(new Date(2026, 10, 21, 23, 59, 59, 999), '2026-11-20T00:00:00.000Z'), false);
});

test('AI Planner occurrence dates do not overflow a short month', () => {
  const monthly = countRepeatOccurrencesUntilDeadline({
    repeat: 'monthly',
    repeatDay: 31,
    start: new Date(2026, 3, 1),
    deadline: new Date(2026, 4, 2),
  });
  assert.equal(monthly.count, 1);
  assert.equal(monthly.lastOccurrence?.getFullYear(), 2026);
  assert.equal(monthly.lastOccurrence?.getMonth(), 3);
  assert.equal(monthly.lastOccurrence?.getDate(), 30);

  const yearly = countRepeatOccurrencesUntilDeadline({
    repeat: 'yearly',
    repeatMonth: 2,
    repeatDay: 29,
    start: new Date(2027, 0, 1),
    deadline: new Date(2027, 11, 31),
  });
  assert.equal(yearly.count, 1);
  assert.equal(yearly.lastOccurrence?.getMonth(), 1);
  assert.equal(yearly.lastOccurrence?.getDate(), 28);

  const missing = countRepeatOccurrencesUntilDeadline({
    repeat: 'weekly',
    start: new Date(2026, 10, 16),
    deadline: new Date(2026, 10, 30),
  });
  assert.equal(missing.count, 0);
  assert.equal(missing.lastOccurrence, null);
});

test('several weekly days and missing monthly days are counted once each', () => {
  const week = countRepeatOccurrencesUntilDeadline({
    repeat: 'weekly',
    repeatDay: 1,
    repeatDays: [1, 2],
    start: new Date(2026, 10, 16),
    deadline: new Date(2026, 10, 17),
  });
  assert.equal(week.count, 2);

  const month = countRepeatOccurrencesUntilDeadline({
    repeat: 'monthly',
    repeatDay: 30,
    repeatDays: [30, 31],
    start: new Date(2026, 0, 1),
    deadline: new Date(2026, 3, 30),
  });
  assert.equal(month.count, 5);
  assert.equal(month.lastOccurrence?.getMonth(), 3);
  assert.equal(month.lastOccurrence?.getDate(), 30);

  const single = countRepeatOccurrencesUntilDeadline({
    repeat: 'monthly',
    repeatDay: 31,
    start: new Date(2026, 1, 1),
    deadline: new Date(2026, 1, 28),
  });
  assert.equal(single.count, 1);
  assert.equal(single.lastOccurrence?.getDate(), 28);
});

test('an impossible deadline is not turned into another day', () => {
  assert.equal(realCivilDate('2026-11-31'), null);
  assert.equal(realCivilDate('2026-02-31'), null);
  assert.equal(realCivilDate('31.11.2026'), null);
  assert.equal(realCivilDate('29.02.2028'), '2028-02-29');
  assert.equal(realCivilDate('2026-11-22'), '2026-11-22');
  assert.equal(deadlineRetryMessage(), `Pick a real deadline from today onward, such as ${deviceCivilDate()}, and try again.`);
  assert.equal(deadlineError('2026-11-31'), deadlineRetryMessage());
  assert.equal(deadlineError('2000-01-01'), deadlineRetryMessage());
  assert.equal(deadlineError('2999-01-01'), null);
  assert.equal(deadlineError(''), null);
});
