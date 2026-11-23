import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countRepeatOccurrencesBetween,
  dashboardProgressPercent,
  expectedRepeatOccurrences,
  isDeterminateRepeat,
  isStepScheduledOnCivilDay,
  isStepScheduledOnDay,
  scheduleWriteError,
  storedInstantCivilDate,
  utcMidnightFromCivil,
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
  assert.equal(scheduleWriteError({ repeat: 'yearly', repeatMonth: 2, repeatDay: 30 }), 'Pick a real month and day, such as yearly:02-29, and try again.');
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
  assert.equal(scheduleWriteError({ repeat: 'hello' }), 'Use daily, weekly:Mon, monthly:15, yearly:02-29, or once:2026-11-22, and try again.');
  assert.equal(isDeterminateRepeat({ repeat: 'hello' }), false);
  assert.equal(countRepeatOccurrencesBetween({ repeat: 'hello' }, new Date(2026, 0, 1), new Date(2026, 11, 31)), 0);
  assert.equal(isStepScheduledOnDay({ repeat: 'yearly', repeatMonth: 2, repeatDay: 29 }, new Date(2027, 1, 28)), true);
  assert.equal(isStepScheduledOnDay({ repeat: 'yearly', repeatMonth: 2, repeatDay: 29 }, new Date(2028, 1, 29)), true);
  assert.equal(isStepScheduledOnDay({ repeat: 'yearly', repeatMonth: 2, repeatDay: 29 }, new Date(2028, 1, 28)), false);
});

test('a daily step added later is not expected before it existed', () => {
  const percent = dashboardProgressPercent({
    steps: [
      { id: 'daily', repeat: 'daily', createdAt: new Date('2026-11-20T10:00:00.000Z') },
      { id: 'blank', repeat: null },
      { id: 'loose', repeat: 'weekly', repeatDay: null },
    ],
    completions: [{ stepId: 'daily', date: '2026-11-20T00:00:00.000Z' }],
    goalCreatedAt: new Date('2026-11-01T10:00:00.000Z'),
    goalDueAt: utcMidnightFromCivil('2026-11-30'),
    legacyTimeZone: 'Europe/Budapest',
  });
  assert.equal(
    countRepeatOccurrencesBetween(
      { repeat: 'daily' },
      new Date(2026, 10, 20),
      new Date(2026, 10, 30)
    ),
    11
  );
  assert.equal(percent, Number(((1 / 11) * 100).toFixed(2)));
});

test('a goal without a deadline does not show the 100-occurrence horizon as progress', () => {
  assert.equal(expectedRepeatOccurrences({ repeat: 'daily' }, new Date(2026, 10, 1), null), 100);
  assert.equal(
    dashboardProgressPercent({
      steps: [
        { id: 'daily', repeat: 'daily' },
        { id: 'hello', repeat: 'hello' },
      ],
      completions: [{ stepId: 'daily', date: '2026-11-01T00:00:00.000Z' }],
      goalCreatedAt: new Date('2026-11-01T10:00:00.000Z'),
      goalDueAt: null,
      legacyTimeZone: 'Europe/Budapest',
    }),
    0
  );
  assert.equal(
    dashboardProgressPercent({
      steps: [{ id: 'weekly', repeat: 'weekly', repeatDay: 1 }],
      completions: [],
      goalCreatedAt: new Date('2026-11-17T10:00:00.000Z'),
      goalDueAt: utcMidnightFromCivil('2026-11-20'),
      legacyTimeZone: 'Europe/Budapest',
    }),
    0
  );
  assert.equal(
    dashboardProgressPercent({
      steps: [],
      completions: [],
      goalCreatedAt: new Date('2026-11-22T10:00:00.000Z'),
      goalDueAt: utcMidnightFromCivil('2026-11-30'),
      legacyTimeZone: 'Europe/Budapest',
    }),
    0
  );
});

test('goal progress is done occurrences divided by every expected occurrence', () => {
  const goal = {
    goalCreatedAt: new Date('2026-11-22T10:00:00.000Z'),
    goalDueAt: utcMidnightFromCivil('2026-11-30'),
    legacyTimeZone: 'Europe/Budapest',
  };
  const steps = [
    { id: 'daily', repeat: 'daily', createdAt: new Date('2026-11-22T10:00:00.000Z') },
    { id: 'sunday', repeat: 'weekly', repeatDay: 0, createdAt: new Date('2026-11-22T10:00:00.000Z') },
  ];
  const dailyOnly = dashboardProgressPercent({
    ...goal,
    steps,
    completions: ['2026-11-22', '2026-11-23', '2026-11-24'].map(date => ({ stepId: 'daily', date: `${date}T00:00:00.000Z` })),
  });
  assert.equal(dailyOnly, 27.27);

  const spread = dashboardProgressPercent({
    ...goal,
    steps,
    completions: [
      { stepId: 'daily', date: '2026-11-22T00:00:00.000Z' },
      { stepId: 'daily', date: '2026-11-23T00:00:00.000Z' },
      { stepId: 'sunday', date: '2026-11-29T00:00:00.000Z' },
    ],
  });
  assert.equal(spread, 27.27);

  const duplicates = dashboardProgressPercent({
    ...goal,
    steps,
    completions: [
      { stepId: 'daily', date: '2026-11-22T00:00:00.000Z' },
      { stepId: 'daily', date: '2026-11-22T00:00:00.000Z' },
      { stepId: 'daily', date: '2026-12-01T00:00:00.000Z' },
      { stepId: 'sunday', date: '2026-11-23T00:00:00.000Z' },
    ],
  });
  assert.equal(duplicates, 9.09);

  const lateStep = dashboardProgressPercent({
    ...goal,
    steps: [
      { id: 'daily', repeat: 'daily', createdAt: new Date('2026-11-24T10:00:00.000Z') },
      steps[1],
    ],
    completions: [{ stepId: 'daily', date: '2026-11-22T00:00:00.000Z' }],
  });
  assert.equal(lateStep, 0);

  const once = dashboardProgressPercent({
    ...goal,
    steps: [{ id: 'once', dueAt: '2026-11-25T00:00:00.000Z', createdAt: new Date('2026-11-22T10:00:00.000Z') }],
    completions: [
      { stepId: 'once', date: '2026-11-25T00:00:00.000Z' },
      { stepId: 'once', date: '2026-11-26T00:00:00.000Z' },
    ],
  });
  assert.equal(once, 100);
});

test('clamped monthly and yearly dates count only on the valid day', () => {
  const april = dashboardProgressPercent({
    steps: [{ id: 'month', repeat: 'monthly', repeatDay: 31, createdAt: new Date('2026-04-01T10:00:00.000Z') }],
    completions: [
      { stepId: 'month', date: '2026-04-30T00:00:00.000Z' },
      { stepId: 'month', date: '2026-04-29T00:00:00.000Z' },
    ],
    goalCreatedAt: new Date('2026-04-01T10:00:00.000Z'),
    goalDueAt: utcMidnightFromCivil('2026-04-30'),
    legacyTimeZone: 'Europe/Budapest',
  });
  assert.equal(april, 100);

  const nonLeap = dashboardProgressPercent({
    steps: [{ id: 'year', repeat: 'yearly', repeatMonth: 2, repeatDay: 29, createdAt: new Date('2026-02-01T10:00:00.000Z') }],
    completions: [
      { stepId: 'year', date: '2026-02-28T00:00:00.000Z' },
      { stepId: 'year', date: '2026-02-27T00:00:00.000Z' },
    ],
    goalCreatedAt: new Date('2026-02-01T10:00:00.000Z'),
    goalDueAt: utcMidnightFromCivil('2026-02-28'),
    legacyTimeZone: 'Europe/Budapest',
  });
  assert.equal(nonLeap, 100);

  const leap = dashboardProgressPercent({
    steps: [{ id: 'year', repeat: 'yearly', repeatMonth: 2, repeatDay: 29, createdAt: new Date('2028-02-01T10:00:00.000Z') }],
    completions: [{ stepId: 'year', date: '2028-02-28T00:00:00.000Z' }],
    goalCreatedAt: new Date('2028-02-01T10:00:00.000Z'),
    goalDueAt: utcMidnightFromCivil('2028-02-29'),
    legacyTimeZone: 'Europe/Budapest',
  });
  assert.equal(leap, 0);
});

test('the same completion follows the caller timezone', () => {
  const args = {
    steps: [{ id: 'sunday', repeat: 'weekly', repeatDay: 0, createdAt: new Date('2026-11-22T00:00:00.000Z') }],
    completions: [{ stepId: 'sunday', date: '2026-11-21T23:00:00.000Z' }],
    goalCreatedAt: new Date('2026-11-22T00:00:00.000Z'),
    goalDueAt: utcMidnightFromCivil('2026-11-30'),
  };
  assert.equal(dashboardProgressPercent({ ...args, legacyTimeZone: 'Europe/Budapest' }), 50);
  assert.equal(dashboardProgressPercent({ ...args, legacyTimeZone: 'America/Los_Angeles' }), 0);
});

test('explicit civil dates survive a timezone different from the server', () => {
  const stored = utcMidnightFromCivil('2026-11-22');
  assert.ok(stored);
  assert.equal(storedInstantCivilDate(stored as Date, 'America/Los_Angeles'), '2026-11-22');
  assert.equal(storedInstantCivilDate(stored as Date, 'Europe/Budapest'), '2026-11-22');
  const legacy = new Date('2026-11-18T23:00:00.000Z');
  assert.equal(storedInstantCivilDate(legacy, 'Europe/Budapest'), '2026-11-19');
  assert.equal(storedInstantCivilDate(legacy, 'America/Los_Angeles'), '2026-11-18');
  assert.equal(isStepScheduledOnCivilDay({ repeat: 'weekly', repeatDay: 0 }, '2026-11-22', 'Europe/Budapest'), true);
  assert.equal(
    isStepScheduledOnCivilDay(
      { dueAt: '2026-11-22T00:00:00.000Z', repeat: null },
      '2026-11-22',
      'America/Los_Angeles'
    ),
    true
  );
  assert.equal(
    isStepScheduledOnCivilDay(
      { dueAt: '2026-11-22T22:59:59.999Z', repeat: 'weekly', repeatDay: 1 },
      '2026-11-22',
      'Europe/Budapest'
    ),
    false
  );
});

function civilDays(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / 86400000) + 1;
}
