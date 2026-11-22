import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProgressSnapshot, type ProgressSnapshot } from '../src/goals/progressSnapshot.ts';
import { verifyRecoveryPlan } from '../src/goals/verifyRecoveryPlan.ts';
import { measureRecoveryCoverage } from '../src/research/experiment/coverage.ts';
import { loadManualExperiment } from '../src/research/experiment/manualExperiment.ts';
import {
  classifyVerifiedRecovery,
  evaluateRuleTasks,
} from '../src/research/experiment/ruleExperiment.ts';
import { planRuleRecovery, type RulePlanningConstraints } from '../src/research/rulePlanner.ts';

const RECORDED_AT = '2026-11-22T00:35:00.000Z';
const READY: RulePlanningConstraints = {
  dailyWorkloadLimitMinutes: 60,
  activityDurationMinutes: 30,
  availabilityStartMinute: 480,
};

function studySnapshot(input?: {
  deadline?: string | null;
  asOf?: string;
  completions?: Array<{ stepId: string; date: string }>;
  steps?: ProgressSnapshot extends never ? never : Parameters<typeof buildProgressSnapshot>[0]['steps'];
}): ProgressSnapshot {
  return buildProgressSnapshot({
    goal: {
      id: 'goal-study',
      title: 'Study',
      createdAt: '2026-11-16',
      deadline: input?.deadline === undefined ? '2026-11-28' : input.deadline,
      completed: false,
      failedAt: null,
    },
    steps: input?.steps ?? [
      {
        id: 'step-study',
        order: 0,
        text: 'Study',
        description: null,
        dueAt: null,
        repeat: 'daily',
        repeatDay: null,
        repeatMonth: null,
      },
    ],
    completions: input?.completions ?? [
      { stepId: 'step-study', date: '2026-11-16' },
      { stepId: 'step-study', date: '2026-11-17' },
      { stepId: 'step-study', date: '2026-11-18' },
    ],
    asOf: input?.asOf ?? '2026-11-21',
  });
}

function verified(snapshot: ProgressSnapshot, constraints: RulePlanningConstraints, required: Array<{ stepId: string; missedDate: string }>) {
  const planned = planRuleRecovery({ snapshot, requiredRecovery: required, constraints });
  assert.equal(planned.outcome, 'PLAN_GENERATED');
  assert.ok(planned.plan);
  const result = verifyRecoveryPlan(snapshot, planned.plan, {
    dailyWorkloadLimitMinutes: constraints.dailyWorkloadLimitMinutes,
  });
  const coverage = measureRecoveryCoverage({ asOf: snapshot.asOf, plan: planned.plan, requiredRecovery: required });
  return { planned, result, coverage };
}

test('a supplied duration and limit produce one verified recovery', () => {
  const snapshot = studySnapshot();
  const required = [{ stepId: 'step-study', missedDate: '2026-11-19' }];
  const { planned, result, coverage } = verified(snapshot, READY, required);
  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.violations, []);
  assert.deepEqual(planned.placed, required);
  assert.deepEqual(
    planned.plan?.activities.filter(item => item.activityId.startsWith('preserve:')).map(item => item.date),
    ['2026-11-16', '2026-11-17', '2026-11-18']
  );
  assert.equal(planned.plan?.activities.find(item => item.activityId.startsWith('recover:'))?.date, '2026-11-21');
  assert.equal(coverage.status, 'COVERED');
  assert.equal(
    classifyVerifiedRecovery({ required: 1, covered: coverage.covered.length, verdict: result.verdict }).recoveryClass,
    'FULL_RECOVERY'
  );
});

test('two missed occurrences are placed on different later dates', () => {
  const snapshot = studySnapshot();
  const required = [
    { stepId: 'step-study', missedDate: '2026-11-19' },
    { stepId: 'step-study', missedDate: '2026-11-20' },
  ];
  const { planned, result, coverage } = verified(snapshot, READY, required);
  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(
    planned.plan?.activities.filter(item => item.activityId.startsWith('recover:')).map(item => item.date),
    ['2026-11-21', '2026-11-22']
  );
  assert.equal(coverage.covered.length, 2);
  assert.equal(
    classifyVerifiedRecovery({ required: 2, covered: 2, verdict: 'PASS' }).recoveryClass,
    'FULL_RECOVERY'
  );
});

test('a deadline on asOf still accepts one recovery on that date', () => {
  const snapshot = studySnapshot({ deadline: '2026-11-21' });
  const required = [{ stepId: 'step-study', missedDate: '2026-11-19' }];
  const { planned, result } = verified(snapshot, READY, required);
  assert.equal(result.verdict, 'PASS');
  assert.equal(planned.plan?.activities.find(item => item.activityId.startsWith('recover:'))?.date, '2026-11-21');
  assert.ok(planned.plan?.activities.every(item => item.date <= '2026-11-21'));
});

test('completed occurrences stay on their dates and an untouched step is left out', () => {
  const snapshot = studySnapshot({
    steps: [
      {
        id: 'step-study',
        order: 0,
        text: 'Study',
        description: null,
        dueAt: null,
        repeat: 'daily',
        repeatDay: null,
        repeatMonth: null,
      },
      {
        id: 'step-once',
        order: 1,
        text: 'Submit notes',
        description: null,
        dueAt: '2026-11-18',
        repeat: null,
        repeatDay: null,
        repeatMonth: null,
      },
    ],
    completions: [
      { stepId: 'step-study', date: '2026-11-16' },
      { stepId: 'step-study', date: '2026-11-17' },
      { stepId: 'step-study', date: '2026-11-18' },
      { stepId: 'step-once', date: '2026-11-18' },
    ],
  });
  const required = [{ stepId: 'step-study', missedDate: '2026-11-19' }];
  const { planned, result } = verified(snapshot, READY, required);
  assert.equal(result.verdict, 'PASS');
  const preserved = planned.plan?.activities.filter(item => item.activityId.startsWith('preserve:')) ?? [];
  assert.deepEqual(preserved.map(item => `${item.stepId}:${item.date}`), [
    'step-study:2026-11-16',
    'step-study:2026-11-17',
    'step-study:2026-11-18',
  ]);
  assert.equal(planned.plan?.activities.some(item => item.stepId === 'step-once'), false);
  assert.equal(planned.plan?.activities.some(item => item.activityId.startsWith('recover:') && item.date === '2026-11-19'), false);
});

test('a duration above the daily limit is infeasible before search', () => {
  const planned = planRuleRecovery({
    snapshot: studySnapshot(),
    requiredRecovery: [{ stepId: 'step-study', missedDate: '2026-11-19' }],
    constraints: { ...READY, activityDurationMinutes: 50, dailyWorkloadLimitMinutes: 40 },
  });
  assert.equal(planned.outcome, 'INFEASIBLE');
  assert.equal(planned.plan, null);
  assert.deepEqual(planned.reasons, ['duration_exceeds_daily_limit']);
  assert.equal(planned.countBoundFeasible, false);
});

test('missing duration is insufficient information and does not invent a length', () => {
  const planned = planRuleRecovery({
    snapshot: studySnapshot(),
    requiredRecovery: [{ stepId: 'step-study', missedDate: '2026-11-19' }],
    constraints: { dailyWorkloadLimitMinutes: 60, availabilityStartMinute: 480 },
  });
  assert.equal(planned.outcome, 'INSUFFICIENT_INFORMATION');
  assert.equal(planned.plan, null);
  assert.ok(planned.missing.includes('missing_activity_duration'));
});

test('an ambiguous weekly step is not assigned a guessed weekday', () => {
  const snapshot = studySnapshot({
    steps: [
      {
        id: 'step-weekly',
        order: 0,
        text: 'Review',
        description: null,
        dueAt: null,
        repeat: 'weekly',
        repeatDay: null,
        repeatMonth: null,
      },
    ],
    completions: [],
  });
  const planned = planRuleRecovery({
    snapshot,
    requiredRecovery: [{ stepId: 'step-weekly', missedDate: '2026-11-19' }],
    constraints: READY,
  });
  assert.equal(planned.outcome, 'INSUFFICIENT_INFORMATION');
  assert.deepEqual(planned.missing, ['ambiguous_schedule']);
  assert.equal(planned.plan, null);
});

test('a deadline already before asOf makes recovery infeasible', () => {
  const planned = planRuleRecovery({
    snapshot: studySnapshot({ deadline: '2026-11-20', asOf: '2026-11-21' }),
    requiredRecovery: [{ stepId: 'step-study', missedDate: '2026-11-19' }],
    constraints: READY,
  });
  assert.equal(planned.outcome, 'INFEASIBLE');
  assert.deepEqual(planned.reasons, ['no_feasible_date']);
  assert.equal(planned.plan, null);
});

test('a node cap stops a feasible search without calling it infeasible', () => {
  const planned = planRuleRecovery({
    snapshot: studySnapshot(),
    requiredRecovery: [
      { stepId: 'step-study', missedDate: '2026-11-19' },
      { stepId: 'step-study', missedDate: '2026-11-20' },
    ],
    constraints: READY,
    maxSearchNodes: 1,
  });
  assert.equal(planned.outcome, 'SEARCH_FAILED');
  assert.deepEqual(planned.reasons, ['search_node_limit']);
  assert.equal(planned.countBoundFeasible, true);
  assert.equal(planned.plan, null);
  assert.ok(planned.searchNodes <= 1);
});

test('identical inputs produce identical plans', () => {
  const snapshot = studySnapshot();
  const input = {
    snapshot,
    requiredRecovery: [
      { stepId: 'step-study', missedDate: '2026-11-20' },
      { stepId: 'step-study', missedDate: '2026-11-19' },
    ],
    constraints: READY,
  };
  assert.deepEqual(planRuleRecovery(input), planRuleRecovery(input));
});

test('partial placement stays partial after a passing verification, and a failed verdict covers nothing', () => {
  const snapshot = studySnapshot({ deadline: '2026-11-21' });
  const required = [
    { stepId: 'step-study', missedDate: '2026-11-19' },
    { stepId: 'step-study', missedDate: '2026-11-20' },
  ];
  const { planned, result, coverage } = verified(snapshot, READY, required);
  assert.equal(result.verdict, 'PASS');
  assert.equal(planned.placed.length, 1);
  assert.equal(planned.unplaced.length, 1);
  assert.deepEqual(planned.reasons, ['full_recovery_exceeds_capacity']);
  assert.equal(coverage.covered.length, 1);
  assert.deepEqual(
    classifyVerifiedRecovery({ required: 2, covered: coverage.covered.length, verdict: 'PASS' }),
    { recoveryClass: 'PARTIAL_RECOVERY', verifiedCovered: 1 }
  );
  assert.deepEqual(classifyVerifiedRecovery({ required: 2, covered: 2, verdict: 'FAIL' }), {
    recoveryClass: 'NOT_GENERATED',
    verifiedCovered: 0,
  });
  assert.deepEqual(classifyVerifiedRecovery({ required: 2, covered: 2, verdict: 'UNKNOWN' }), {
    recoveryClass: 'NOT_GENERATED',
    verifiedCovered: 0,
  });
});

test('no declared misses produce an empty verified plan', () => {
  const snapshot = studySnapshot();
  const planned = planRuleRecovery({ snapshot, requiredRecovery: [], constraints: { dailyWorkloadLimitMinutes: 60 } });
  assert.equal(planned.outcome, 'PLAN_GENERATED');
  assert.deepEqual(planned.plan?.activities, []);
  const result = verifyRecoveryPlan(snapshot, planned.plan ?? { goalId: snapshot.goal.id, activities: [] }, {
    dailyWorkloadLimitMinutes: 60,
  });
  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(classifyVerifiedRecovery({ required: 0, covered: 0, verdict: 'PASS' }), {
    recoveryClass: 'FULL_RECOVERY',
    verifiedCovered: 0,
  });
});

test('frozen tasks keep missing durations and are not scored with the manual plans', () => {
  const tasks = loadManualExperiment().tasks.map(task => ({
    ...task,
    expectedVerdict: null,
    constraints: { dailyWorkloadLimitMinutes: task.constraints.dailyWorkloadLimitMinutes ?? null },
  }));
  const run = evaluateRuleTasks(tasks, { recordedAt: RECORDED_AT });
  assert.equal(run.summary.scenarios, 13);
  assert.deepEqual(run.summary.planner, {
    PLAN_GENERATED: 2,
    INSUFFICIENT_INFORMATION: 11,
    INFEASIBLE: 0,
    SEARCH_FAILED: 0,
  });
  assert.deepEqual(run.summary.verifier, { PASS: 2, FAIL: 0, UNKNOWN: 0, notRun: 11 });
  assert.equal(run.summary.unknownCountedAsPass, false);
  assert.deepEqual(run.summary.rawCoverage, { covered: 0, required: 19, percentage: 0 });
  assert.deepEqual(run.summary.verifiedCoverage, { covered: 0, required: 19, percentage: 0 });
  assert.ok(run.results.filter(result => result.required > 0).every(result => result.missing.includes('missing_activity_duration')));
  assert.ok(run.results.filter(result => result.required === 0).every(result => result.verifierVerdict === 'PASS'));
});
