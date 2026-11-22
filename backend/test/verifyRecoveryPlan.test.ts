import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProgressSnapshot, type ProgressSnapshot } from '../src/goals/progressSnapshot.ts';
import {
  verifyRecoveryPlan,
  type RecoveryActivity,
  type RecoveryConstraints,
  type RecoveryPlan,
} from '../src/goals/verifyRecoveryPlan.ts';

function guitarSnapshot(partial?: { deadline?: string | null; asOf?: string; extraSteps?: ProgressSnapshot['steps'] }): ProgressSnapshot {
  const built = buildProgressSnapshot({
    goal: {
      id: 'goal-1',
      title: 'Practice guitar',
      createdAt: '2026-11-17',
      deadline: partial?.deadline === undefined ? '2026-11-28' : partial.deadline,
      completed: false,
      failedAt: null,
    },
    asOf: partial?.asOf ?? '2026-11-21',
    steps: [
      {
        id: 'scales',
        order: 0,
        text: 'Play scales',
        description: null,
        dueAt: null,
        repeat: 'daily',
        repeatDay: null,
        repeatMonth: null,
      },
      {
        id: 'song',
        order: 1,
        text: 'Record one song',
        description: null,
        dueAt: '2026-11-27',
        repeat: null,
        repeatDay: null,
        repeatMonth: null,
      },
    ],
    completions: [{ stepId: 'scales', date: '2026-11-19' }],
  });
  if (!partial?.extraSteps) return built;
  return { ...built, steps: [...built.steps, ...partial.extraSteps] };
}

function activity(partial: RecoveryActivity): RecoveryActivity {
  return partial;
}

function timed(partial: RecoveryActivity): RecoveryActivity {
  return { durationMinutes: 20, startMinuteOfDay: 8 * 60, ...partial };
}

const limits: RecoveryConstraints = { dailyWorkloadLimitMinutes: 60 };

function codes(result: { violations: { code: string }[] }) {
  return result.violations.map(item => item.code);
}

test('a missed day can be recovered later without dropping the reported completion', () => {
  const result = verifyRecoveryPlan(
    guitarSnapshot(),
    {
      goalId: 'goal-1',
      activities: [
        timed({ activityId: 'done', stepId: 'scales', date: '2026-11-19' }),
        timed({ activityId: 'recover', stepId: 'scales', date: '2026-11-22', startMinuteOfDay: 9 * 60 }),
        timed({ activityId: 'song', stepId: 'song', date: '2026-11-27', startMinuteOfDay: 18 * 60 }),
      ],
    },
    limits
  );

  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.notEvaluated, []);
  assert.equal(result.progressMeaning, 'self_report_not_verified_achievement');
  assert.equal(result.checks.every(check => check.status === 'PASS'), true);
});

test('leaving an unedited step out of the plan keeps its DONE occurrence', () => {
  const result = verifyRecoveryPlan(
    guitarSnapshot(),
    {
      goalId: 'goal-1',
      activities: [timed({ activityId: 'song', stepId: 'song', date: '2026-11-27', startMinuteOfDay: 18 * 60 })],
    },
    limits
  );
  assert.equal(result.verdict, 'PASS');
  assert.equal(codes(result).includes('DONE_DROPPED'), false);
});

test('moving work past the deadline fails', () => {
  const result = verifyRecoveryPlan(
    guitarSnapshot(),
    {
      goalId: 'goal-1',
      activities: [
        timed({ activityId: 'done', stepId: 'scales', date: '2026-11-19' }),
        timed({ activityId: 'late', stepId: 'scales', date: '2026-11-29' }),
      ],
    },
    limits
  );
  assert.equal(result.verdict, 'FAIL');
  assert.ok(codes(result).includes('AFTER_DEADLINE'));
});

test('a plan that edits a step must keep every DONE date', () => {
  const result = verifyRecoveryPlan(
    guitarSnapshot(),
    {
      goalId: 'goal-1',
      activities: [timed({ activityId: 'recover', stepId: 'scales', date: '2026-11-22' })],
    },
    limits
  );
  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(codes(result), ['DONE_DROPPED']);
});

test('unknown, duplicate, and malformed activities fail', () => {
  const plan: RecoveryPlan = {
    goalId: 'other-goal',
    activities: [
      timed({ activityId: 'a', stepId: 'missing', date: '2026-11-22' }),
      timed({ activityId: 'a', stepId: 'scales', date: '2026-11-22' }),
      timed({ activityId: 'b', stepId: 'scales', date: '2026-11-22' }),
      timed({ activityId: 'e', stepId: 'scales', date: '2026-11-22' }),
      timed({ activityId: 'c', stepId: 'scales', date: '2026-02-31' }),
      timed({ activityId: 'd', stepId: 'scales', date: '2026-11-23', durationMinutes: 0 }),
    ],
  };
  const result = verifyRecoveryPlan(guitarSnapshot(), plan, limits);
  assert.equal(result.verdict, 'FAIL');
  for (const code of ['GOAL_MISMATCH', 'UNKNOWN_STEP', 'DUPLICATE_ACTIVITY', 'DUPLICATE_OCCURRENCE', 'MALFORMED_DATE', 'MALFORMED_ACTIVITY']) {
    assert.ok(codes(result).includes(code), code);
  }
});

test('a new activity on a missed past date fails, while the DONE date may stay', () => {
  const result = verifyRecoveryPlan(
    guitarSnapshot(),
    {
      goalId: 'goal-1',
      activities: [
        timed({ activityId: 'done', stepId: 'scales', date: '2026-11-19' }),
        timed({ activityId: 'missed', stepId: 'scales', date: '2026-11-20' }),
      ],
    },
    limits
  );
  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(codes(result), ['PAST_DATE']);
});

test('workload overload fails only from explicit durations and a daily limit', () => {
  const result = verifyRecoveryPlan(
    guitarSnapshot(),
    {
      goalId: 'goal-1',
      activities: [
        timed({ activityId: 'done', stepId: 'scales', date: '2026-11-19', durationMinutes: 20 }),
        timed({ activityId: 'scales-day', stepId: 'scales', date: '2026-11-22', durationMinutes: 40, startMinuteOfDay: 8 * 60 }),
        timed({ activityId: 'song-day', stepId: 'song', date: '2026-11-22', durationMinutes: 30, startMinuteOfDay: 18 * 60 }),
        timed({ activityId: 'song', stepId: 'song', date: '2026-11-27', durationMinutes: 20, startMinuteOfDay: 18 * 60 }),
      ],
    },
    { dailyWorkloadLimitMinutes: 60 }
  );
  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(codes(result), ['WORKLOAD_EXCEEDED']);
});

test('overlapping explicit time slots fail', () => {
  const result = verifyRecoveryPlan(
    guitarSnapshot(),
    {
      goalId: 'goal-1',
      activities: [
        timed({ activityId: 'done', stepId: 'scales', date: '2026-11-19' }),
        timed({ activityId: 'scales-day', stepId: 'scales', date: '2026-11-22', durationMinutes: 60, startMinuteOfDay: 8 * 60 }),
        timed({ activityId: 'song-day', stepId: 'song', date: '2026-11-22', durationMinutes: 60, startMinuteOfDay: 8 * 60 + 30 }),
        timed({ activityId: 'song', stepId: 'song', date: '2026-11-27', startMinuteOfDay: 18 * 60 }),
      ],
    },
    { dailyWorkloadLimitMinutes: 180 }
  );
  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(codes(result), ['TIME_CONFLICT']);
});

test('missing duration and workload data are UNKNOWN, not PASS', () => {
  const result = verifyRecoveryPlan(guitarSnapshot(), {
    goalId: 'goal-1',
    activities: [
      activity({ activityId: 'done', stepId: 'scales', date: '2026-11-19' }),
      activity({ activityId: 'recover', stepId: 'scales', date: '2026-11-22' }),
    ],
  });
  assert.equal(result.verdict, 'UNKNOWN');
  assert.deepEqual(result.violations, []);
  assert.ok(result.notEvaluated.some(check => check.code === 'TIME_CONFLICT'));
  assert.ok(result.notEvaluated.some(check => check.code === 'WORKLOAD'));
  assert.equal(result.checks.some(check => check.status === 'PASS' && check.code === 'DEADLINE'), true);
});

test('an ambiguous step cannot be treated as a feasible schedule', () => {
  const snapshot = guitarSnapshot();
  snapshot.steps.push({
    id: 'loose',
    order: 2,
    text: 'Sometime',
    description: null,
    schedule: { type: 'none' },
    occurrenceStatus: 'ambiguous',
    ambiguity: 'weekly_missing_weekday',
  });
  const unknown = verifyRecoveryPlan(
    snapshot,
    {
      goalId: 'goal-1',
      activities: [timed({ activityId: 'loose', stepId: 'loose', date: '2026-11-23', startMinuteOfDay: 10 * 60 })],
    },
    limits
  );
  assert.equal(unknown.verdict, 'UNKNOWN');
  assert.deepEqual(unknown.violations, []);
  assert.equal(unknown.notEvaluated[0]?.code, 'SCHEDULE_KNOWN');

  const failed = verifyRecoveryPlan(
    snapshot,
    {
      goalId: 'goal-1',
      activities: [timed({ activityId: 'loose', stepId: 'loose', date: '2026-11-18', startMinuteOfDay: 10 * 60 })],
    },
    limits
  );
  assert.equal(failed.verdict, 'FAIL');
  assert.ok(codes(failed).includes('PAST_DATE'));
  assert.ok(failed.notEvaluated.some(check => check.code === 'SCHEDULE_KNOWN'));
});

test('no date is both today-or-later and on or before an already passed deadline', () => {
  const result = verifyRecoveryPlan(
    guitarSnapshot({ deadline: '2026-11-20', asOf: '2026-11-21' }),
    {
      goalId: 'goal-1',
      activities: [
        timed({ activityId: 'done', stepId: 'scales', date: '2026-11-19' }),
        timed({ activityId: 'today', stepId: 'scales', date: '2026-11-21' }),
      ],
    },
    limits
  );
  assert.equal(result.verdict, 'FAIL');
  assert.ok(codes(result).includes('NO_FEASIBLE_DATE'));
  assert.ok(codes(result).includes('AFTER_DEADLINE'));
});

test('a goal with no deadline does not pass the deadline check', () => {
  const result = verifyRecoveryPlan(
    guitarSnapshot({ deadline: null }),
    {
      goalId: 'goal-1',
      activities: [
        timed({ activityId: 'done', stepId: 'scales', date: '2026-11-19' }),
        timed({ activityId: 'recover', stepId: 'scales', date: '2026-11-22' }),
      ],
    },
    limits
  );
  assert.equal(result.verdict, 'UNKNOWN');
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.notEvaluated.map(check => check.code), ['DEADLINE']);
});
