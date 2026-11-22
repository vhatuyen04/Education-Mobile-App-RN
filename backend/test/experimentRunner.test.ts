import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildProgressSnapshot } from '../src/goals/progressSnapshot.ts';
import { measureRecoveryCoverage } from '../src/research/experiment/coverage.ts';
import { MANUAL_EXPERIMENT_ID, loadManualExperiment } from '../src/research/experiment/manualExperiment.ts';
import {
  runExperiment,
  stableRecord,
  type ExperimentProposal,
  type ExperimentRecord,
  type ExperimentTask,
} from '../src/research/experiment/experimentRunner.ts';
import { writeExperimentOutput } from '../src/research/experiment/writeExperiment.ts';

const RECORDED_AT = '2026-11-22T00:18:00.000Z';

function studyTask(constraints: ExperimentTask['constraints'], expectedVerdict: ExperimentTask['expectedVerdict']): ExperimentTask {
  return {
    scenarioId: 'study',
    snapshot: buildProgressSnapshot({
      goal: {
        id: 'goal-study',
        title: 'Study',
        createdAt: '2026-11-16',
        deadline: '2026-11-28',
        completed: false,
        failedAt: null,
      },
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
      ],
      completions: [{ stepId: 'step-study', date: '2026-11-16' }],
      asOf: '2026-11-21',
    }),
    constraints,
    expectedVerdict,
    requiredRecovery: [{ stepId: 'step-study', missedDate: '2026-11-19' }],
  };
}

function proposal(planId: string, activities: ExperimentProposal['plan']['activities']): ExperimentProposal {
  return {
    scenarioId: 'study',
    planId,
    method: 'manual',
    plan: { goalId: 'goal-study', activities },
  };
}

test('one replacement activity covers one missed occurrence and ignores the missed date itself', () => {
  const covered = measureRecoveryCoverage({
    asOf: '2026-11-21',
    requiredRecovery: [
      { stepId: 'step-study', missedDate: '2026-11-19' },
      { stepId: 'step-study', missedDate: '2026-11-20' },
    ],
    plan: {
      goalId: 'goal-study',
      activities: [
        { activityId: 'past-miss', stepId: 'step-study', date: '2026-11-20' },
        { activityId: 'later', stepId: 'step-study', date: '2026-11-22' },
      ],
    },
  });
  assert.equal(covered.status, 'PARTIAL');
  assert.deepEqual(covered.covered, [{ stepId: 'step-study', missedDate: '2026-11-19' }]);
  assert.deepEqual(covered.uncovered, [{ stepId: 'step-study', missedDate: '2026-11-20' }]);
});

test('summary counts keep UNKNOWN separate from PASS, including a passing plan that misses required recovery', () => {
  const passTask = studyTask({ dailyWorkloadLimitMinutes: 60 }, 'PASS');
  const failTask = { ...studyTask({ dailyWorkloadLimitMinutes: 60 }, 'FAIL'), scenarioId: 'study-fail' };
  const unknownTask = { ...studyTask({}, 'UNKNOWN'), scenarioId: 'study-unknown' };
  const run = runExperiment({
    experimentId: 'unit-summary',
    recordedAt: RECORDED_AT,
    tasks: [passTask, failTask, unknownTask],
    proposals: [
      proposal('keep-only', [{ activityId: 'done', stepId: 'step-study', date: '2026-11-16', durationMinutes: 30, startMinuteOfDay: 480 }]),
      {
        ...proposal('too-late', [
          { activityId: 'done', stepId: 'step-study', date: '2026-11-16', durationMinutes: 30, startMinuteOfDay: 480 },
          { activityId: 'late', stepId: 'step-study', date: '2026-11-29', durationMinutes: 30, startMinuteOfDay: 540 },
        ]),
        scenarioId: 'study-fail',
        planId: 'too-late',
      },
      {
        ...proposal('undated', [
          { activityId: 'done', stepId: 'step-study', date: '2026-11-16' },
          { activityId: 'later', stepId: 'step-study', date: '2026-11-22' },
        ]),
        scenarioId: 'study-unknown',
        planId: 'undated',
      },
    ],
  });

  assert.deepEqual(run.summary.counts, { PASS: 1, FAIL: 1, UNKNOWN: 1, total: 3 });
  assert.equal(run.summary.unknownCountedAsPass, false);
  assert.equal(run.summary.counts.PASS + run.summary.counts.UNKNOWN, 2);
  assert.notEqual(run.summary.counts.PASS, run.summary.counts.PASS + run.summary.counts.UNKNOWN);

  const byPlan = new Map(run.records.map(record => [record.planId, record]));
  assert.equal(byPlan.get('keep-only')?.actualVerdict, 'PASS');
  assert.equal(byPlan.get('keep-only')?.recovery.status, 'NOT_COVERED');
  assert.equal(byPlan.get('too-late')?.actualVerdict, 'FAIL');
  assert.deepEqual(byPlan.get('too-late')?.violationCodes, ['AFTER_DEADLINE']);
  assert.equal(byPlan.get('too-late')?.recovery.status, 'COVERED');
  assert.equal(byPlan.get('undated')?.actualVerdict, 'UNKNOWN');
  assert.deepEqual(byPlan.get('undated')?.violationCodes, []);
  assert.deepEqual(byPlan.get('undated')?.notEvaluated, ['TIME_CONFLICT', 'WORKLOAD']);
  assert.equal(byPlan.get('undated')?.recovery.status, 'COVERED');
});

test('result files repeat every field except verification runtime', () => {
  const task = studyTask({ dailyWorkloadLimitMinutes: 60 }, 'PASS');
  const input = {
    experimentId: 'unit-log',
    recordedAt: RECORDED_AT,
    tasks: [task],
    proposals: [
      proposal('keep-only', [
        { activityId: 'done', stepId: 'step-study', date: '2026-11-16', durationMinutes: 30, startMinuteOfDay: 480 },
      ]),
    ],
  };
  const first = runExperiment(input);
  const second = runExperiment(input);
  assert.deepEqual(first.records.map(stableRecord), second.records.map(stableRecord));
  assert.equal(Number.isFinite(first.records[0]?.verificationRuntimeMs), true);
  assert.ok((first.records[0]?.verificationRuntimeMs ?? -1) >= 0);

  const directory = mkdtempSync(join(tmpdir(), 'tdk-experiment-'));
  const paths = writeExperimentOutput(directory, first);
  const lines = readFileSync(paths.results, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0] ?? '{}') as ExperimentRecord;
  const { verificationRuntimeMs, ...logged } = parsed;
  assert.deepEqual(logged, stableRecord(first.records[0] as ExperimentRecord));
  assert.equal(Number.isFinite(verificationRuntimeMs), true);
  assert.deepEqual(JSON.parse(readFileSync(paths.summary, 'utf8')), first.summary);

  const tasks = JSON.parse(readFileSync(paths.tasks, 'utf8')) as {
    reusableBy: string[];
    tasks: Array<{ scenarioId: string; constraints: unknown; snapshot: { asOf: string }; requiredRecovery: unknown }>;
  };
  assert.deepEqual(tasks.reusableBy, ['manual', 'rule', 'direct_context_llm', 'mcp']);
  assert.equal(tasks.tasks[0]?.snapshot.asOf, '2026-11-21');
  assert.deepEqual(tasks.tasks[0]?.constraints, { dailyWorkloadLimitMinutes: 60 });
  assert.equal(Object.hasOwn(tasks.tasks[0] ?? {}, 'plan'), false);

  const proposals = JSON.parse(readFileSync(paths.proposals, 'utf8')) as {
    proposals: Array<{ planId: string; method: string }>;
  };
  assert.equal(proposals.proposals[0]?.planId, 'keep-only');
  assert.equal(proposals.proposals[0]?.method, 'manual');
});

test('the 13 manual scenarios log the predeclared verdicts and recovery coverage', () => {
  const loaded = loadManualExperiment();
  const run = runExperiment({
    experimentId: MANUAL_EXPERIMENT_ID,
    recordedAt: RECORDED_AT,
    tasks: loaded.tasks,
    proposals: loaded.proposals,
  });
  assert.equal(run.records.length, 13);
  assert.deepEqual(run.summary.counts, { PASS: 3, FAIL: 7, UNKNOWN: 3, total: 13 });
  assert.equal(run.summary.unknownCountedAsPass, false);
  assert.deepEqual(run.summary.expectedComparisons, { matched: 13, mismatched: 0, notDeclared: 0 });
  assert.deepEqual(run.summary.recovery, {
    requiredItems: 19,
    coveredItems: 9,
    COVERED: 4,
    PARTIAL: 4,
    NOT_COVERED: 3,
    NOT_REQUIRED: 2,
  });

  const byScenario = new Map(run.records.map(record => [record.scenarioId, record]));
  const untouched = byScenario.get('goal-a-constraints-without-recovery');
  assert.equal(untouched?.actualVerdict, 'PASS');
  assert.equal(untouched?.recovery.status, 'NOT_COVERED');
  assert.deepEqual(
    untouched?.recovery.uncovered.map(item => item.missedDate),
    ['2026-11-19', '2026-11-20']
  );

  const missing = byScenario.get('goal-a-missing-constraints');
  assert.equal(missing?.actualVerdict, 'UNKNOWN');
  assert.deepEqual(missing?.notEvaluated, ['TIME_CONFLICT', 'WORKLOAD']);
  assert.equal(missing?.recovery.status, 'PARTIAL');

  const partial = byScenario.get('goal-a-done-dropped');
  assert.equal(partial?.actualVerdict, 'FAIL');
  assert.equal(partial?.recovery.covered[0]?.missedDate, '2026-11-19');
  assert.equal(partial?.recovery.uncovered[0]?.missedDate, '2026-11-20');

  for (const record of run.records) {
    assert.equal(record.progressMeaning, 'self_report_not_verified_achievement');
    assert.equal(record.experimentId, MANUAL_EXPERIMENT_ID);
    assert.equal(record.planId, `manual:${record.scenarioId}`);
  }
});
