import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProgressSnapshot } from '../src/goals/progressSnapshot.ts';
import {
  countRepeatOccurrencesBetween,
  dashboardProgressPercent,
  todayOccurrencePercent,
  utcMidnightFromCivil,
} from '../src/goals/recurrenceSchedule.ts';
import { archiveDecision, completionAllowed, planReplacement, stepHistory } from '../src/goals/stepLifecycle.ts';
import { verifyRecoveryPlan } from '../src/goals/verifyRecoveryPlan.ts';

const zone = 'Europe/Budapest';
const goalCreated = new Date('2026-11-22T10:00:00.000Z');
const goalDue = '2026-11-30T00:00:00.000Z';

test('a step added after the goal starts does not charge the earlier days', () => {
  const percent = dashboardProgressPercent({
    steps: [{ id: 'late', repeat: 'daily', createdAt: new Date('2026-11-26T10:00:00.000Z') }],
    completions: [
      { stepId: 'late', date: '2026-11-22T00:00:00.000Z' },
      { stepId: 'late', date: '2026-11-26T00:00:00.000Z' },
    ],
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    legacyTimeZone: zone,
  });
  assert.equal(countRepeatOccurrencesBetween({ repeat: 'daily' }, new Date(2026, 10, 26), new Date(2026, 10, 30)), 5);
  assert.equal(percent, 20);
});

test('replacing a step can raise progress by shrinking the remaining denominator', () => {
  const before = dashboardProgressPercent({
    steps: [{ id: 'old', repeat: 'daily', createdAt: goalCreated }],
    completions: [
      { stepId: 'old', date: '2026-11-22T00:00:00.000Z' },
      { stepId: 'old', date: '2026-11-23T00:00:00.000Z' },
    ],
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    legacyTimeZone: zone,
  });
  const plan = planReplacement({
    stepId: 'old',
    todayCivil: '2026-11-28',
    scheduledToday: true,
    now: new Date('2026-11-28T10:00:00.000Z'),
    text: 'Once',
    dueAt: '2026-11-27T00:00:00.000Z',
  });
  assert.ok(!('error' in plan));
  if ('error' in plan) return;
  assert.equal(plan.next.effectiveFrom, '2026-11-28');
  assert.equal(plan.previous.effectiveUntil, '2026-11-28');
  const after = dashboardProgressPercent({
    steps: [
      {
        id: 'old',
        repeat: 'daily',
        createdAt: goalCreated,
        archivedAt: plan.previous.archivedAt,
        effectiveUntil: `${plan.previous.effectiveUntil}T00:00:00.000Z`,
      },
      {
        id: 'next',
        dueAt: plan.next.dueAt,
        createdAt: new Date('2026-11-28T10:00:00.000Z'),
        effectiveFrom: `${plan.next.effectiveFrom}T00:00:00.000Z`,
      },
    ],
    completions: [
      { stepId: 'old', date: '2026-11-22T00:00:00.000Z' },
      { stepId: 'old', date: '2026-11-23T00:00:00.000Z' },
    ],
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    legacyTimeZone: zone,
  });
  assert.equal(before, 22.22);
  assert.equal(after, Number(((2 / 7) * 100).toFixed(2)));
  assert.ok(after > before);
});

test('a replacement once date before its effective start adds no occurrence', () => {
  const percent = dashboardProgressPercent({
    steps: [{
      id: 'next',
      dueAt: '2026-11-23T00:00:00.000Z',
      createdAt: new Date('2026-11-24T10:00:00.000Z'),
      effectiveFrom: '2026-11-24T00:00:00.000Z',
    }],
    completions: [{ stepId: 'next', date: '2026-11-23T00:00:00.000Z' }],
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    legacyTimeZone: zone,
  });
  assert.equal(percent, 0);
});

test('same-day replacement counts both step ids and does not invent a completion', () => {
  const decision = archiveDecision({
    archivedAt: null,
    todayCivil: '2026-11-24',
    scheduledToday: true,
    now: new Date('2026-11-24T10:00:00.000Z'),
  });
  assert.equal(decision.effectiveUntil, '2026-11-24');
  const history = stepHistory({
    step: {
      id: 'old',
      repeat: 'daily',
      createdAt: goalCreated,
      archivedAt: decision.archivedAt,
      effectiveUntil: `${decision.effectiveUntil}T00:00:00.000Z`,
    },
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    completions: [{ date: '2026-11-22T00:00:00.000Z' }],
    now: new Date('2026-11-24T10:00:00.000Z'),
    legacyTimeZone: zone,
  });
  assert.equal(history.occurrences.find(row => row.date === '2026-11-24')?.status, 'MISSED');
  assert.equal(history.occurrences.find(row => row.date === '2026-11-22')?.status, 'DONE');
  assert.equal(completionAllowed({ archivedAt: decision.archivedAt }), false);
  const today = todayOccurrencePercent({
    steps: [
      {
        id: 'old',
        repeat: 'daily',
        createdAt: goalCreated,
        archivedAt: decision.archivedAt,
        effectiveUntil: `${decision.effectiveUntil}T00:00:00.000Z`,
      },
      {
        id: 'next',
        repeat: 'daily',
        createdAt: new Date('2026-11-24T10:00:00.000Z'),
        effectiveFrom: '2026-11-24T00:00:00.000Z',
      },
    ],
    completions: [{ stepId: 'old', date: '2026-11-22T00:00:00.000Z' }],
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    civilToday: '2026-11-24',
    legacyTimeZone: zone,
  });
  assert.equal(today, 0);
});

test('an unscheduled completion does not count and a scheduled one does, including a future day', () => {
  const base = {
    steps: [{ id: 'daily', repeat: 'daily', createdAt: goalCreated }],
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    legacyTimeZone: zone,
  };
  assert.equal(dashboardProgressPercent({ ...base, completions: [{ stepId: 'daily', date: '2026-11-21T00:00:00.000Z' }] }), 0);
  assert.equal(dashboardProgressPercent({ ...base, completions: [{ stepId: 'daily', date: '2026-11-22T00:00:00.000Z' }] }), Number(((1 / 9) * 100).toFixed(2)));
  assert.equal(dashboardProgressPercent({ ...base, completions: [{ stepId: 'daily', date: '2026-11-30T00:00:00.000Z' }] }), Number(((1 / 9) * 100).toFixed(2)));
});

test('three replacement versions stay separate in the progress denominator', () => {
  const percent = dashboardProgressPercent({
    steps: [
      { id: 'a', repeat: 'daily', createdAt: goalCreated, archivedAt: '2026-11-24T10:00:00.000Z', effectiveUntil: '2026-11-24T00:00:00.000Z' },
      { id: 'b', repeat: 'daily', createdAt: new Date('2026-11-24T10:00:00.000Z'), effectiveFrom: '2026-11-24T00:00:00.000Z', archivedAt: '2026-11-26T10:00:00.000Z', effectiveUntil: '2026-11-26T00:00:00.000Z' },
      { id: 'c', repeat: 'daily', createdAt: new Date('2026-11-26T10:00:00.000Z'), effectiveFrom: '2026-11-26T00:00:00.000Z' },
    ],
    completions: [
      { stepId: 'a', date: '2026-11-24T00:00:00.000Z' },
      { stepId: 'b', date: '2026-11-24T00:00:00.000Z' },
      { stepId: 'c', date: '2026-11-26T00:00:00.000Z' },
    ],
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    legacyTimeZone: zone,
  });
  assert.equal(percent, Number(((3 / 11) * 100).toFixed(2)));
});

test('a snapshot before replacement cannot see the new step or a later archive', () => {
  const goal = { id: 'g', title: 'Run', createdAt: '2026-11-22', deadline: '2026-11-30', completed: false, failedAt: null };
  const oldStep = {
    id: 'a',
    order: 0,
    text: 'Run',
    description: 'Original',
    dueAt: null,
    repeat: 'daily',
    repeatDay: null,
    repeatMonth: null,
    createdAt: '2026-11-22',
    archivedOn: '2026-11-24',
    effectiveUntil: '2026-11-24',
  };
  const before = buildProgressSnapshot({
    goal,
    steps: [
      oldStep,
      { ...oldStep, id: 'b', text: 'Next', description: 'Replacement', createdAt: '2026-11-24', archivedOn: null, effectiveUntil: null, effectiveFrom: '2026-11-24' },
    ],
    completions: [{ stepId: 'a', date: '2026-11-22' }],
    asOf: '2026-11-23',
    pastHorizonDays: 10,
    futureHorizonDays: 10,
  });
  assert.deepEqual(before.steps.map(step => step.id), ['a']);
  assert.equal(before.steps[0]?.lifecycle, 'active');
  assert.equal(before.occurrences.find(row => row.date === '2026-11-22')?.status, 'DONE');
  assert.equal(before.occurrences.find(row => row.date === '2026-11-23')?.status, 'TODO');
  const rejected = verifyRecoveryPlan(before, {
    goalId: 'g',
    activities: [{ activityId: 'later', stepId: 'a', date: '2026-11-23', durationMinutes: 10 }],
  }, { dailyWorkloadLimitMinutes: 60 });
  assert.equal(rejected.violations.some(item => item.code === 'ARCHIVED_STEP'), false);
});

test('daily occurrence counts include the leap day and survive a long range', () => {
  assert.equal(
    countRepeatOccurrencesBetween({ repeat: 'daily' }, new Date(2024, 1, 28), new Date(2024, 2, 1)),
    3
  );
  const percent = dashboardProgressPercent({
    steps: [{ id: 'year', repeat: 'daily', createdAt: new Date('2026-01-01T10:00:00.000Z') }],
    completions: [{ stepId: 'year', date: '2026-01-01T00:00:00.000Z' }],
    goalCreatedAt: new Date('2026-01-01T10:00:00.000Z'),
    goalDueAt: '2026-12-31T00:00:00.000Z',
    legacyTimeZone: zone,
  });
  assert.equal(percent, Number(((1 / 365) * 100).toFixed(2)));
});
