import assert from 'node:assert/strict';
import test from 'node:test';

import { DELETE_STEP_MESSAGE, durationPhrase, readDurationMinutes, replaceStepCopy, schedulePhrase, stepOverviewFacts } from '../src/utils/stepLifecycle.ts';
import { stepDateAfterGoalError, stepOutsideActiveRangeError } from '../src/utils/stepSchedule.ts';
import { goalProgressLabel } from '../src/utils/goalProgress.ts';

test('Home and Goals List keep one label, including archived history percents', () => {
  const goal = { dueAt: '2026-11-30T00:00:00.000Z', progressPct: 27.27 };
  assert.equal(goalProgressLabel(goal), 'Progress: 27.27%');
  assert.equal(goalProgressLabel({ dueAt: null, progressPct: 100 }), 'No deadline');
});

test('delete and replace explain the lifecycle before saving', () => {
  assert.match(DELETE_STEP_MESSAGE, /end it immediately/);
  assert.match(DELETE_STEP_MESSAGE, /recorded as missed/);
  const copy = replaceStepCopy('2026-11-23', '2026-11-23');
  assert.equal(copy.title, 'Replace this step?');
  assert.match(copy.lead, /archive the current version/);
  assert.match(copy.lead, /its own progress history/);
  assert.match(copy.records, /DONE and MISSED records will be preserved/);
  assert.match(copy.records, /scheduled dates/);
  assert.equal(copy.currentEnds, '2026-11-23');
  assert.equal(copy.nextStarts, '2026-11-23');
});

test('step detail separates a scheduled date from the active window', () => {
  const onceSame = stepOverviewFacts({
    step: { dueAt: '2026-11-25T00:00:00.000Z', repeat: null, durationMinutes: null },
    effectiveStart: '2026-11-25',
    effectiveEnd: '2026-11-25',
    today: '2026-11-23',
  });
  assert.equal(onceSame.schedule.label, 'Scheduled');
  assert.equal(onceSame.schedule.value, 'Nov 25');
  assert.equal(onceSame.range, null);
  assert.equal(onceSame.duration, null);

  const onceWindow = stepOverviewFacts({
    step: { dueAt: '2026-11-25T00:00:00.000Z', repeat: 'once', durationMinutes: 25 },
    effectiveStart: '2026-11-22',
    effectiveEnd: '2026-11-30',
    today: '2026-11-23',
  });
  assert.equal(onceWindow.schedule.value, 'Nov 25');
  assert.equal(onceWindow.range?.label, 'Active');
  assert.equal(onceWindow.range?.value, 'Nov 22 – Nov 30');
  assert.equal(onceWindow.duration?.value, '25 min');

  const daily = stepOverviewFacts({
    step: { repeat: 'daily', durationMinutes: null },
    effectiveStart: '2026-11-22',
    effectiveEnd: '2026-11-30',
    today: '2026-11-23',
  });
  assert.equal(daily.schedule.value, 'Every day');
  assert.equal(daily.range?.value, 'Nov 22 – Nov 30');
  assert.equal(daily.duration, null);

  const weekly = stepOverviewFacts({
    step: { repeat: 'weekly', repeatDay: 1 },
    effectiveStart: '2026-11-22',
    effectiveEnd: null,
    today: '2026-11-23',
  });
  assert.equal(weekly.schedule.value, 'Every Monday');
  assert.equal(weekly.range?.label, 'Active from');
  assert.equal(weekly.range?.value, 'Nov 22');

  const archived = stepOverviewFacts({
    step: { repeat: 'daily' },
    effectiveStart: '2026-11-22',
    effectiveEnd: '2026-11-23',
    today: '2026-11-23',
  });
  assert.equal(archived.range?.value, 'Nov 22 – Nov 23');
});

test('a step date on the goal deadline is allowed and a later date is not', () => {
  assert.equal(stepDateAfterGoalError('2026-11-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z'), null);
  assert.equal(stepDateAfterGoalError(null, '2026-11-27T00:00:00.000Z'), null);
  const message = stepDateAfterGoalError('2026-11-28T00:00:00.000Z', '2026-11-27');
  assert.match(message ?? '', /cannot be later than the goal deadline/);
  assert.match(message ?? '', /on or before 2026-11-27/);
});

test('a new step date before today is rejected', () => {
  const past = stepOutsideActiveRangeError({ dueAt: '2026-11-22T00:00:00.000Z' }, '2026-11-27T00:00:00.000Z', '2026-11-23');
  assert.match(past ?? '', /from 2026-11-23 through 2026-11-27/);
  assert.equal(stepOutsideActiveRangeError({ dueAt: '2026-11-23T00:00:00.000Z' }, '2026-11-27T00:00:00.000Z', '2026-11-23'), null);
  assert.match(stepOutsideActiveRangeError({ repeat: 'weekly', repeatDay: 0 }, '2026-11-24', '2026-11-23') ?? '', /through 2026-11-24/);
  assert.equal(stepOutsideActiveRangeError({ repeat: 'daily' }, '2026-11-27', '2026-11-23'), null);
});

test('duration stays optional and schedules stay readable', () => {
  assert.equal(readDurationMinutes(''), null);
  assert.equal(readDurationMinutes('25'), 25);
  assert.equal(readDurationMinutes('0'), 'invalid');
  assert.equal(durationPhrase(null), 'No duration');
  assert.equal(schedulePhrase({ repeat: 'weekly', repeatDay: 0 }), 'Every Sunday');
  assert.equal(schedulePhrase({ repeat: 'daily' }), 'Every day');
  assert.equal(schedulePhrase({}), 'No schedule');
});
