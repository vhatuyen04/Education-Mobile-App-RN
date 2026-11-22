import assert from 'node:assert/strict';
import test from 'node:test';

import { civilDateInTimeZone } from '../src/goals/mapProgressSnapshotRows.ts';
import {
  GOAL_A_ID,
  GOAL_B_ID,
  GOAL_C_ID,
  GOAL_D_ID,
  GOAL_E_ID,
  PIPELINE_AS_OF,
  PIPELINE_TIME_ZONE,
  budapestEndOfDay,
  budapestMidnight,
  goalA,
  goalC,
  goalE,
  pipelineFixtures,
  pipelineScenarios,
} from '../src/research/fixtures/pipelineFixtures.ts';
import { runRecoveryPipeline } from '../src/research/runRecoveryPipeline.ts';

test('stored instants are Budapest civil dates, not host-local dates', () => {
  const midnight = budapestMidnight('2026-11-16');
  const deadline = budapestEndOfDay('2026-11-28');
  assert.equal(midnight.toISOString(), '2026-11-15T23:00:00.000Z');
  assert.equal(deadline.toISOString(), '2026-11-28T22:59:59.999Z');
  assert.equal(civilDateInTimeZone(midnight, PIPELINE_TIME_ZONE), '2026-11-16');
  assert.equal(civilDateInTimeZone(midnight, 'UTC'), '2026-11-15');
  assert.equal(civilDateInTimeZone(deadline, PIPELINE_TIME_ZONE), '2026-11-28');
  assert.equal(goalA.completions[0]?.date.toISOString(), midnight.toISOString());
  assert.equal(goalC.completions[2]?.date.toISOString(), budapestMidnight('2026-11-19').toISOString());
});

test('fixtures keep application-realistic rows separate from the synthetic conflict', () => {
  const byId = new Map(pipelineFixtures.map(fixture => [fixture.goal.id, fixture.category]));
  assert.equal(byId.get(GOAL_A_ID), 'application-realistic');
  assert.equal(byId.get(GOAL_B_ID), 'application-realistic');
  assert.equal(byId.get(GOAL_C_ID), 'application-realistic');
  assert.equal(byId.get(GOAL_D_ID), 'application-realistic');
  assert.equal(byId.get(GOAL_E_ID), 'synthetic-edge');
  assert.equal(goalE.steps[0]?.dueAt instanceof Date, true);
  assert.equal(goalE.steps[0]?.repeat, 'daily');
  assert.equal(goalA.steps[0]?.done, false);
  assert.equal(goalA.goal.requirementSource, 'USER');
  assert.equal(goalA.goal.pointsAwarded, 0);
  assert.equal(goalA.goal.xpAwarded, 0);
  for (const scenario of pipelineScenarios) {
    const fixture = pipelineFixtures.find(item => item.goal.id === scenario.goalId);
    assert.equal(scenario.category, fixture?.category);
  }
});

test('the pipeline matches the hand-counted snapshots and the predeclared verdicts', () => {
  const report = runRecoveryPipeline();
  assert.equal(report.databaseQueried, false);
  assert.equal(report.asOf, PIPELINE_AS_OF);
  assert.equal(report.timeZone, PIPELINE_TIME_ZONE);
  assert.equal(report.assertion, 'PASS', JSON.stringify(report.scenarios.filter(item => item.assertion === 'FAIL'), null, 2));

  for (const goal of report.goals) {
    assert.equal(goal.summaryMatchesOccurrences, true, goal.goalId);
    assert.equal(goal.snapshotMatchesExpectation, true, goal.mismatches.join('; '));
    assert.equal(
      goal.summary.total,
      goal.summary.done + goal.summary.missed + goal.summary.todo + goal.summary.future
    );
  }

  const byScenario = new Map(report.scenarios.map(item => [item.id, item]));
  assert.equal(byScenario.get('goal-a-valid-recovery')?.actualVerdict, 'PASS');
  assert.equal(byScenario.get('goal-a-after-deadline')?.actualVerdict, 'FAIL');
  assert.deepEqual(byScenario.get('goal-a-after-deadline')?.actualViolationCodes, ['AFTER_DEADLINE']);
  assert.equal(byScenario.get('goal-a-past-date')?.actualVerdict, 'FAIL');
  assert.equal(byScenario.get('goal-a-done-dropped')?.actualVerdict, 'FAIL');
  assert.equal(byScenario.get('goal-a-unknown-step')?.actualVerdict, 'FAIL');
  assert.equal(byScenario.get('goal-a-duplicate-activity')?.actualVerdict, 'FAIL');
  assert.equal(byScenario.get('goal-b-workload')?.actualVerdict, 'FAIL');
  assert.equal(byScenario.get('goal-b-time-conflict')?.actualVerdict, 'FAIL');
  assert.equal(byScenario.get('goal-a-missing-constraints')?.actualVerdict, 'UNKNOWN');
  assert.deepEqual(byScenario.get('goal-a-missing-constraints')?.actualViolationCodes, []);
  assert.equal(byScenario.get('goal-d-ambiguous-schedule')?.actualVerdict, 'UNKNOWN');
  assert.equal(byScenario.get('goal-a-constraints-without-recovery')?.actualVerdict, 'PASS');
  assert.equal(byScenario.get('goal-a-constraints-without-recovery')?.recoversMissedWork, false);
  assert.equal(byScenario.get('goal-c-off-schedule-completion')?.actualVerdict, 'PASS');
  assert.equal(byScenario.get('goal-e-synthetic-conflict')?.actualVerdict, 'UNKNOWN');
  assert.equal(byScenario.get('goal-e-synthetic-conflict')?.category, 'synthetic-edge');

  const goalCRun = report.goals.find(goal => goal.goalId === GOAL_C_ID);
  assert.equal(goalCRun?.unscheduled.length, 1);
  assert.equal(goalCRun?.unscheduled[0]?.reason, 'not_a_scheduled_date');
  assert.equal(goalCRun?.summary.missed, 1);
});
