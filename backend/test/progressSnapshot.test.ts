import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECURRENCE_POLICY_VERSION,
  buildProgressSnapshot,
  type ProgressSnapshotCompletion,
  type ProgressSnapshotGoal,
  type ProgressSnapshotStep,
} from '../src/goals/progressSnapshot.ts';
import { countRepeatOccurrencesBetween, isStepScheduledOnDay } from '../src/goals/recurrenceSchedule.ts';

function goal(partial: Partial<ProgressSnapshotGoal> = {}): ProgressSnapshotGoal {
  return {
    id: 'goal-1',
    title: 'Practice guitar',
    createdAt: '2026-11-17',
    deadline: '2026-11-28',
    completed: false,
    failedAt: null,
    ...partial,
  };
}

function step(partial: Partial<ProgressSnapshotStep> & Pick<ProgressSnapshotStep, 'id'>): ProgressSnapshotStep {
  return {
    order: 0,
    text: partial.id,
    description: null,
    dueAt: null,
    repeat: null,
    repeatDay: null,
    repeatMonth: null,
    ...partial,
  };
}

function snapshot(args: {
  goal?: ProgressSnapshotGoal;
  steps?: ProgressSnapshotStep[];
  completions?: ProgressSnapshotCompletion[];
  asOf?: string;
  futureHorizonDays?: number;
  pastHorizonDays?: number;
}) {
  return buildProgressSnapshot({
    goal: args.goal ?? goal(),
    steps: args.steps ?? [],
    completions: args.completions ?? [],
    asOf: args.asOf ?? '2026-11-21',
    futureHorizonDays: args.futureHorizonDays,
    pastHorizonDays: args.pastHorizonDays,
  });
}

function statusOn(stepId: string, date: string, rows: { stepId: string; date: string; status: string }[]) {
  return rows.find(row => row.stepId === stepId && row.date === date)?.status;
}

test('one-time step is missed, todo, or future relative to asOf', () => {
  const result = snapshot({
    goal: goal({ createdAt: '2026-11-01', deadline: '2026-11-30' }),
    steps: [
      step({ id: 'before', order: 0, text: 'Before', dueAt: '2026-11-20' }),
      step({ id: 'today', order: 1, text: 'Today', dueAt: '2026-11-21' }),
      step({ id: 'after', order: 2, text: 'After', dueAt: '2026-11-22' }),
    ],
  });

  assert.equal(statusOn('before', '2026-11-20', result.occurrences), 'MISSED');
  assert.equal(statusOn('today', '2026-11-21', result.occurrences), 'TODO');
  assert.equal(statusOn('after', '2026-11-22', result.occurrences), 'FUTURE');
  assert.equal(result.occurrences.filter(row => row.stepId === 'before').length, 1);
});

test('daily step keeps done, missed, and todo on different dates', () => {
  const result = snapshot({
    steps: [step({ id: 'scales', text: 'Play scales', repeat: 'daily' })],
    completions: [{ stepId: 'scales', date: '2026-11-19' }],
  });

  assert.equal(statusOn('scales', '2026-11-19', result.occurrences), 'DONE');
  assert.equal(statusOn('scales', '2026-11-20', result.occurrences), 'MISSED');
  assert.equal(statusOn('scales', '2026-11-21', result.occurrences), 'TODO');
  assert.equal(result.occurrences.find(row => row.date === '2026-11-19')?.evidence, 'self_report');
});

test('completing one recurring date leaves the other dates open', () => {
  const result = snapshot({
    steps: [step({ id: 'scales', text: 'Play scales', repeat: 'daily' })],
    completions: [{ stepId: 'scales', date: '2026-11-19' }],
  });
  const scales = result.occurrences.filter(row => row.stepId === 'scales');
  assert.equal(scales.filter(row => row.status === 'DONE').length, 1);
  assert.ok(scales.some(row => row.status !== 'DONE'));
});

test('weekly schedule uses Sunday-zero weekday from the schema', () => {
  const result = snapshot({
    goal: goal({ createdAt: '2026-11-16', deadline: '2026-11-30' }),
    steps: [step({ id: 'monday', text: 'Monday practice', repeat: 'weekly', repeatDay: 1 })],
  });

  assert.deepEqual(
    result.occurrences.map(row => row.date),
    ['2026-11-16', '2026-11-23', '2026-11-30']
  );
  assert.equal(result.occurrences[0]?.status, 'MISSED');
  assert.equal(result.occurrences[1]?.status, 'FUTURE');
  assert.deepEqual(result.steps[0]?.schedule, { type: 'repeat', repeat: 'weekly', repeatDay: 1 });
});

test('weekly schedule without a weekday is ambiguous and generates nothing', () => {
  const result = snapshot({
    steps: [step({ id: 'loose', text: 'Sometime', repeat: 'weekly', repeatDay: null })],
    completions: [{ stepId: 'loose', date: '2026-11-18' }],
  });

  assert.equal(result.occurrences.length, 0);
  assert.deepEqual(result.ambiguousSteps, [{ stepId: 'loose', reason: 'weekly_missing_weekday' }]);
  assert.equal(result.unscheduledCompletions[0]?.reason, 'ambiguous_schedule');
  assert.equal(result.summary.done, 0);
});

test('monthly and yearly short dates clamp to the last valid day', () => {
  const result = snapshot({
    goal: goal({ createdAt: '2024-01-01', deadline: '2028-12-31' }),
    asOf: '2026-06-01',
    pastHorizonDays: 1000,
    futureHorizonDays: 1000,
    steps: [
      step({ id: 'month-end', order: 0, text: 'Month end', repeat: 'monthly', repeatDay: 31 }),
      step({ id: 'leap', order: 1, text: 'Leap day', repeat: 'yearly', repeatMonth: 2, repeatDay: 29 }),
      step({ id: 'year-end', order: 2, text: 'Year end', repeat: 'yearly', repeatMonth: 12, repeatDay: 31 }),
    ],
    completions: [{ stepId: 'month-end', date: '2026-04-30' }],
  });

  assert.equal(result.recurrencePolicy, RECURRENCE_POLICY_VERSION);
  assert.equal(result.limitations.includes('short_months_clamp_to_last_valid_day'), true);
  assert.equal(result.limitations.includes('nonexistent_monthly_and_yearly_dates_are_omitted'), false);

  const monthEnd = result.occurrences.filter(row => row.stepId === 'month-end').map(row => row.date);
  assert.ok(monthEnd.includes('2026-01-31'));
  assert.ok(monthEnd.includes('2026-02-28'));
  assert.equal(monthEnd.includes('2026-02-31'), false);
  assert.ok(monthEnd.includes('2026-04-30'));
  assert.equal(monthEnd.includes('2026-04-29'), false);
  assert.ok(monthEnd.includes('2026-03-31'));
  assert.equal(statusOn('month-end', '2026-04-30', result.occurrences), 'DONE');
  assert.equal(
    monthEnd.length,
    countRepeatOccurrencesBetween(
      { repeat: 'monthly', repeatDay: 31 },
      new Date(2024, 0, 1),
      new Date(2028, 11, 31)
    )
  );

  const leap = result.occurrences.filter(row => row.stepId === 'leap').map(row => row.date);
  assert.deepEqual(leap, ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  assert.equal(isStepScheduledOnDay({ repeat: 'yearly', repeatMonth: 2, repeatDay: 29 }, new Date(2027, 1, 28)), true);
  assert.equal(isStepScheduledOnDay({ repeat: 'yearly', repeatMonth: 2, repeatDay: 29 }, new Date(2028, 1, 29)), true);
  assert.equal(isStepScheduledOnDay({ repeat: 'yearly', repeatMonth: 2, repeatDay: 29 }, new Date(2028, 1, 28)), false);

  const yearEnd = result.occurrences.filter(row => row.stepId === 'year-end').map(row => row.date);
  assert.deepEqual(yearEnd, ['2024-12-31', '2025-12-31', '2026-12-31', '2027-12-31', '2028-12-31']);
  assert.equal(statusOn('year-end', '2025-12-31', result.occurrences), 'MISSED');
  assert.equal(statusOn('year-end', '2026-12-31', result.occurrences), 'FUTURE');
});

test('an impossible yearly date stays ambiguous and a missing weekday is unchanged', () => {
  const impossible = snapshot({
    steps: [step({ id: 'bad-year', text: 'Bad year', repeat: 'yearly', repeatMonth: 2, repeatDay: 30 })],
  });
  assert.equal(impossible.occurrences.length, 0);
  assert.deepEqual(impossible.ambiguousSteps, [{ stepId: 'bad-year', reason: 'yearly_impossible_date' }]);
});

test('daily dates cross a month boundary', () => {
  const result = snapshot({
    goal: goal({ createdAt: '2026-01-30', deadline: '2026-02-02' }),
    asOf: '2026-01-31',
    steps: [step({ id: 'daily', repeat: 'daily' })],
  });

  assert.deepEqual(
    result.occurrences.map(row => `${row.date}:${row.status}`),
    ['2026-01-30:MISSED', '2026-01-31:TODO', '2026-02-01:FUTURE', '2026-02-02:FUTURE']
  );
});

test('a completion on a non-scheduled date stays unscheduled', () => {
  const result = snapshot({
    goal: goal({ createdAt: '2026-11-16', deadline: '2026-11-30' }),
    steps: [step({ id: 'monday', repeat: 'weekly', repeatDay: 1 })],
    completions: [{ stepId: 'monday', date: '2026-11-17' }],
  });

  assert.equal(result.occurrences.some(row => row.date === '2026-11-17'), false);
  assert.deepEqual(result.unscheduledCompletions, [
    { stepId: 'monday', date: '2026-11-17', evidence: 'self_report', reason: 'not_a_scheduled_date' },
  ]);
  assert.equal(result.summary.done, 0);
});

test('a scheduled completion outside the horizon is preserved and not called unscheduled', () => {
  const result = snapshot({
    goal: goal({ createdAt: '2026-01-01', deadline: '2026-12-31' }),
    steps: [step({ id: 'scales', repeat: 'daily' })],
    completions: [
      { stepId: 'scales', date: '2026-11-01' },
      { stepId: 'scales', date: '2026-12-20' },
    ],
  });

  assert.equal(result.window.truncatedPast, true);
  assert.equal(result.window.truncatedFuture, true);
  assert.deepEqual(result.unscheduledCompletions, []);
  assert.deepEqual(result.completionsOutsideWindow, [
    { stepId: 'scales', date: '2026-11-01', evidence: 'self_report', scheduled: true },
    { stepId: 'scales', date: '2026-12-20', evidence: 'self_report', scheduled: true },
  ]);
  assert.equal(result.occurrences.some(row => row.date === '2026-11-01' || row.date === '2026-12-20'), false);
});

test('deadline stops expansion before the horizon, and the horizon stops expansion before a later deadline', () => {
  const atDeadline = snapshot({
    goal: goal({ createdAt: '2026-11-21', deadline: '2026-11-24' }),
    futureHorizonDays: 14,
    steps: [step({ id: 'daily', repeat: 'daily' })],
  });
  assert.equal(atDeadline.window.to, '2026-11-24');
  assert.equal(atDeadline.window.truncatedFuture, false);
  assert.deepEqual(atDeadline.occurrences.map(row => row.date), [
    '2026-11-21',
    '2026-11-22',
    '2026-11-23',
    '2026-11-24',
  ]);

  const atHorizon = snapshot({
    futureHorizonDays: 5,
    steps: [
      step({ id: 'scales', order: 0, text: 'Play scales', repeat: 'daily' }),
      step({ id: 'song', order: 1, text: 'Record one song', dueAt: '2026-11-27' }),
    ],
  });
  assert.equal(atHorizon.window.to, '2026-11-26');
  assert.equal(atHorizon.window.truncatedFuture, true);
  assert.equal(atHorizon.occurrences.some(row => row.stepId === 'song'), false);
  assert.equal(atHorizon.limitations.includes('future_truncated_by_study_horizon'), true);
});

test('the same input returns the same snapshot', () => {
  const input = {
    goal: goal(),
    steps: [
      step({ id: 'scales', order: 1, text: 'Play scales', repeat: 'daily' }),
      step({ id: 'song', order: 0, text: 'Record one song', dueAt: '2026-11-27' }),
    ],
    completions: [
      { stepId: 'scales', date: '2026-11-19' },
      { stepId: 'scales', date: '2026-11-19' },
    ],
    asOf: '2026-11-21',
  };
  assert.deepEqual(buildProgressSnapshot(input), buildProgressSnapshot(input));
});

test('summary counts are the occurrence array', () => {
  const result = snapshot({
    steps: [step({ id: 'scales', repeat: 'daily' })],
    completions: [{ stepId: 'scales', date: '2026-11-19' }],
  });
  assert.equal(result.summary.done, result.occurrences.filter(row => row.status === 'DONE').length);
  assert.equal(result.summary.missed, result.occurrences.filter(row => row.status === 'MISSED').length);
  assert.equal(result.summary.todo, result.occurrences.filter(row => row.status === 'TODO').length);
  assert.equal(result.summary.future, result.occurrences.filter(row => row.status === 'FUTURE').length);
  assert.equal(result.summary.total, result.occurrences.length);
});

test('empty steps, missing constraints, and malformed schedules stay explicit', () => {
  const empty = snapshot({ steps: [] });
  assert.deepEqual(empty.occurrences, []);
  assert.equal(empty.summary.total, 0);
  assert.equal(empty.constraints.workloadLimit, null);
  assert.equal(empty.constraints.taskDurationMinutes, null);
  assert.equal(empty.constraints.userPreferences, null);
  assert.equal(empty.constraints.verifiedAchievement, null);
  assert.deepEqual(empty.missing, [
    'workloadLimit',
    'taskDurationMinutes',
    'timeOfDay',
    'userPreferences',
    'verifiedAchievement',
  ]);

  const malformed = snapshot({
    steps: [
      step({ id: 'blank', text: 'No schedule' }),
      step({ id: 'hourly', order: 1, text: 'Hourly', repeat: 'hourly' }),
      step({ id: 'bad-due', order: 2, text: 'Bad due', dueAt: '2026-02-31' }),
      step({ id: 'both', order: 3, text: 'Both', dueAt: '2026-11-22', repeat: 'daily' }),
    ],
    completions: [{ stepId: 'missing-step', date: 'not-a-date' }],
  });
  assert.equal(malformed.steps.find(row => row.id === 'blank')?.occurrenceStatus, 'unscheduled');
  assert.deepEqual(malformed.ambiguousSteps, [
    { stepId: 'bad-due', reason: 'invalid_due_date' },
    { stepId: 'both', reason: 'conflicting_due_and_repeat' },
    { stepId: 'hourly', reason: 'unknown_repeat' },
  ]);
  assert.equal(malformed.occurrences.length, 0);
  assert.equal(malformed.unscheduledCompletions[0]?.reason, 'unparseable_date');
});

test('regression fixture: scales done on 19 Nov and a song on 27 Nov', () => {
  const result = snapshot({
    steps: [
      step({ id: 'step-scales', order: 0, text: 'Play scales', repeat: 'daily' }),
      step({ id: 'step-song', order: 1, text: 'Record one song', dueAt: '2026-11-27' }),
    ],
    completions: [{ stepId: 'step-scales', date: '2026-11-19' }],
  });

  assert.equal(result.summary.done, 1);
  assert.equal(result.summary.missed, 3);
  assert.equal(result.summary.todo, 1);
  assert.equal(result.summary.future, 8);
  assert.equal(result.summary.total, 13);
  assert.equal(result.occurrences.length, 13);
  assert.equal(statusOn('step-scales', '2026-11-17', result.occurrences), 'MISSED');
  assert.equal(statusOn('step-scales', '2026-11-18', result.occurrences), 'MISSED');
  assert.equal(statusOn('step-scales', '2026-11-19', result.occurrences), 'DONE');
  assert.equal(statusOn('step-scales', '2026-11-20', result.occurrences), 'MISSED');
  assert.equal(statusOn('step-scales', '2026-11-21', result.occurrences), 'TODO');
  assert.equal(statusOn('step-song', '2026-11-27', result.occurrences), 'FUTURE');
  assert.deepEqual(result.unscheduledCompletions, []);
  assert.deepEqual(result.ambiguousSteps, []);
  assert.equal(result.window.truncatedPast, false);
  assert.equal(result.window.truncatedFuture, false);
});
