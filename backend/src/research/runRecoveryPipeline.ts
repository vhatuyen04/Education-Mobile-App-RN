/**
 * Runs the recovery pipeline on in-memory Prisma-shaped rows.
 *
 * Mock rows → mapStoredGoalToSnapshotInput → buildProgressSnapshot →
 * verifyRecoveryPlan. It does not open a database, call a model, or start MCP.
 *
 * From backend/:
 *   npx tsx src/research/runRecoveryPipeline.ts
 */

import { type ProgressSnapshot } from '../goals/progressSnapshot.js';
import { verifyRecoveryPlan } from '../goals/verifyRecoveryPlan.js';
import { buildFixtureProgressSnapshot } from './buildFixtureSnapshot.js';
import {
  PIPELINE_AS_OF,
  PIPELINE_TIME_ZONE,
  pipelineFixtures,
  pipelineScenarios,
  type PipelineFixture,
  type PipelineScenario,
} from './fixtures/pipelineFixtures.js';

export type ScenarioRun = {
  id: string;
  category: PipelineScenario['category'];
  goalId: string;
  title: string;
  expectedVerdict: PipelineScenario['expectedVerdict'];
  actualVerdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  expectedViolationCodes: string[];
  actualViolationCodes: string[];
  expectedNotEvaluated: string[];
  actualNotEvaluated: string[];
  recoversMissedWork: boolean;
  expectRecoversMissedWork: boolean | null;
  assertion: 'PASS' | 'FAIL';
  mismatches: string[];
};

export type GoalRun = {
  category: PipelineFixture['category'];
  goalId: string;
  title: string;
  producedBy: string;
  summary: ProgressSnapshot['summary'];
  occurrences: Array<{ date: string; stepId: string; text: string; status: string }>;
  unscheduled: ProgressSnapshot['unscheduledCompletions'];
  ambiguous: ProgressSnapshot['ambiguousSteps'];
  summaryMatchesOccurrences: boolean;
  snapshotMatchesExpectation: boolean;
  mismatches: string[];
};

export type PipelineReport = {
  timeZone: string;
  asOf: string;
  databaseQueried: false;
  goals: GoalRun[];
  scenarios: ScenarioRun[];
  assertion: 'PASS' | 'FAIL';
};

export function runRecoveryPipeline(): PipelineReport {
  const built = new Map<string, { fixture: PipelineFixture; snapshot: ProgressSnapshot; goalRun: GoalRun }>();

  for (const fixture of pipelineFixtures) {
    const snapshot = buildFixtureProgressSnapshot(fixture);
    const textById = new Map(snapshot.steps.map(row => [row.id, row.text]));
    const counted = countStatuses(snapshot);
    const mismatches: string[] = [];
    if (!sameSummary(snapshot.summary, counted)) mismatches.push('summary does not match the occurrence array');
    if (!sameSummary(snapshot.summary, fixture.expectedSummary)) {
      mismatches.push(
        `summary ${formatSummary(snapshot.summary)} != expected ${formatSummary(fixture.expectedSummary)}`
      );
    }
    const actualOccurrences = snapshot.occurrences.map(row => ({
      stepId: row.stepId,
      date: row.date,
      status: row.status,
    }));
    if (JSON.stringify(actualOccurrences) !== JSON.stringify(fixture.expectedOccurrences)) {
      mismatches.push('occurrence list does not match the hand-counted expectation');
    }
    const actualUnscheduled = snapshot.unscheduledCompletions.map(row => ({
      stepId: row.stepId,
      date: row.date,
      reason: row.reason,
    }));
    if (JSON.stringify(actualUnscheduled) !== JSON.stringify(fixture.expectedUnscheduled)) {
      mismatches.push('unscheduled completions do not match the expectation');
    }
    const actualAmbiguous = snapshot.ambiguousSteps.map(row => ({ stepId: row.stepId, reason: row.reason }));
    if (JSON.stringify(actualAmbiguous) !== JSON.stringify(fixture.expectedAmbiguous)) {
      mismatches.push('ambiguous steps do not match the expectation');
    }
    if (snapshot.goal.id !== fixture.goal.id) mismatches.push('snapshot goal id changed');
    built.set(fixture.goal.id, {
      fixture,
      snapshot,
      goalRun: {
        category: fixture.category,
        goalId: fixture.goal.id,
        title: fixture.goal.title,
        producedBy: fixture.producedBy,
        summary: snapshot.summary,
        occurrences: snapshot.occurrences.map(row => ({
          date: row.date,
          stepId: row.stepId,
          text: textById.get(row.stepId) ?? row.stepId,
          status: row.status,
        })),
        unscheduled: snapshot.unscheduledCompletions,
        ambiguous: snapshot.ambiguousSteps,
        summaryMatchesOccurrences: sameSummary(snapshot.summary, counted),
        snapshotMatchesExpectation: mismatches.length === 0,
        mismatches,
      },
    });
  }

  const scenarios: ScenarioRun[] = pipelineScenarios.map(scenario => {
    const found = built.get(scenario.goalId);
    if (!found) {
      return {
        id: scenario.id,
        category: scenario.category,
        goalId: scenario.goalId,
        title: '(missing fixture)',
        expectedVerdict: scenario.expectedVerdict,
        actualVerdict: 'FAIL',
        expectedViolationCodes: scenario.expectedViolationCodes,
        actualViolationCodes: ['FIXTURE_MISSING'],
        expectedNotEvaluated: scenario.expectedNotEvaluated,
        actualNotEvaluated: [],
        recoversMissedWork: false,
        expectRecoversMissedWork: scenario.expectRecoversMissedWork,
        assertion: 'FAIL',
        mismatches: ['no fixture for this goal'],
      };
    }
    const result = verifyRecoveryPlan(found.snapshot, scenario.plan, scenario.constraints);
    const actualViolationCodes = result.violations.map(item => item.code);
    const actualNotEvaluated = result.notEvaluated.map(item => item.code);
    const recoversMissedWork = planRecoversMissedWork(found.snapshot, scenario.plan);
    const mismatches: string[] = [];
    if (result.verdict !== scenario.expectedVerdict) {
      mismatches.push(`verdict ${result.verdict} != expected ${scenario.expectedVerdict}`);
    }
    if (codesKey(actualViolationCodes) !== codesKey(scenario.expectedViolationCodes)) {
      mismatches.push(
        `violations [${actualViolationCodes.join(', ')}] != expected [${scenario.expectedViolationCodes.join(', ')}]`
      );
    }
    if (actualNotEvaluated.join(',') !== scenario.expectedNotEvaluated.join(',')) {
      mismatches.push(
        `not evaluated [${actualNotEvaluated.join(', ')}] != expected [${scenario.expectedNotEvaluated.join(', ')}]`
      );
    }
    if (result.progressMeaning !== 'self_report_not_verified_achievement') {
      mismatches.push('progress meaning was not recorded as self-report');
    }
    if (scenario.expectRecoversMissedWork != null && recoversMissedWork !== scenario.expectRecoversMissedWork) {
      mismatches.push(
        `missed-work recovery ${recoversMissedWork} != expected ${scenario.expectRecoversMissedWork}`
      );
    }
    if (result.verdict === 'UNKNOWN' && scenario.expectedVerdict === 'PASS') {
      mismatches.push('UNKNOWN was compared as if it were PASS');
    }
    return {
      id: scenario.id,
      category: scenario.category,
      goalId: scenario.goalId,
      title: found.fixture.goal.title,
      expectedVerdict: scenario.expectedVerdict,
      actualVerdict: result.verdict,
      expectedViolationCodes: scenario.expectedViolationCodes,
      actualViolationCodes,
      expectedNotEvaluated: scenario.expectedNotEvaluated,
      actualNotEvaluated,
      recoversMissedWork,
      expectRecoversMissedWork: scenario.expectRecoversMissedWork,
      assertion: mismatches.length === 0 ? 'PASS' : 'FAIL',
      mismatches,
    };
  });

  const goals = [...built.values()].map(item => item.goalRun);
  const failed = goals.some(goal => !goal.snapshotMatchesExpectation) || scenarios.some(item => item.assertion === 'FAIL');
  return {
    timeZone: PIPELINE_TIME_ZONE,
    asOf: PIPELINE_AS_OF,
    databaseQueried: false,
    goals,
    scenarios,
    assertion: failed ? 'FAIL' : 'PASS',
  };
}

export function formatPipelineReport(report: PipelineReport): string {
  const lines: string[] = [
    'TDK recovery pipeline',
    `time zone: ${report.timeZone}`,
    `asOf: ${report.asOf}`,
    'database queried: no',
    '',
  ];
  for (const goal of report.goals) {
    lines.push(`Goal ${goal.goalId}  ${goal.title}`);
    lines.push(`category: ${goal.category}`);
    lines.push(`summary: ${formatSummary(goal.summary)}`);
    lines.push('occurrences:');
    if (goal.occurrences.length === 0) lines.push('  (none)');
    for (const row of goal.occurrences) {
      lines.push(`  ${row.date}  ${row.text}  ${row.status}`);
    }
    if (goal.unscheduled.length === 0) lines.push('unscheduled completions: none');
    else {
      lines.push('unscheduled completions:');
      for (const row of goal.unscheduled) lines.push(`  ${row.date}  ${row.stepId}  ${row.reason}`);
    }
    if (goal.ambiguous.length === 0) lines.push('ambiguous steps: none');
    else {
      lines.push('ambiguous steps:');
      for (const row of goal.ambiguous) lines.push(`  ${row.stepId}  ${row.reason}`);
    }
    lines.push(`snapshot assertion: ${goal.snapshotMatchesExpectation ? 'PASS' : 'FAIL'}`);
    for (const mismatch of goal.mismatches) lines.push(`  mismatch: ${mismatch}`);
    lines.push('');
  }
  for (const scenario of report.scenarios) {
    lines.push(`scenario ${scenario.id}`);
    lines.push(`goal: ${scenario.goalId}  ${scenario.title}`);
    lines.push(`category: ${scenario.category}`);
    lines.push(`expected verdict: ${scenario.expectedVerdict}`);
    lines.push(`actual verdict:   ${scenario.actualVerdict}`);
    lines.push(`violation codes: ${scenario.actualViolationCodes.join(', ') || '(none)'}`);
    lines.push(`not evaluated: ${scenario.actualNotEvaluated.join(', ') || '(none)'}`);
    if (scenario.expectRecoversMissedWork != null) {
      lines.push(`reschedules missed work: ${scenario.recoversMissedWork}`);
    }
    lines.push(`assertion: ${scenario.assertion}`);
    for (const mismatch of scenario.mismatches) lines.push(`  mismatch: ${mismatch}`);
    lines.push('');
  }
  const passed = report.scenarios.filter(item => item.assertion === 'PASS').length;
  lines.push(`scenarios ${passed}/${report.scenarios.length} passed`);
  lines.push(`pipeline assertion: ${report.assertion}`);
  return `${lines.join('\n')}\n`;
}

function planRecoversMissedWork(snapshot: ProgressSnapshot, plan: { activities: Array<{ stepId: string; date: string }> }): boolean {
  const missedSteps = new Set(
    snapshot.occurrences.filter(row => row.status === 'MISSED').map(row => row.stepId)
  );
  return plan.activities.some(activity => missedSteps.has(activity.stepId) && activity.date >= snapshot.asOf);
}

function countStatuses(snapshot: ProgressSnapshot): ProgressSnapshot['summary'] {
  return {
    done: snapshot.occurrences.filter(row => row.status === 'DONE').length,
    missed: snapshot.occurrences.filter(row => row.status === 'MISSED').length,
    todo: snapshot.occurrences.filter(row => row.status === 'TODO').length,
    future: snapshot.occurrences.filter(row => row.status === 'FUTURE').length,
    total: snapshot.occurrences.length,
  };
}

function sameSummary(left: ProgressSnapshot['summary'], right: ProgressSnapshot['summary']): boolean {
  return (
    left.done === right.done &&
    left.missed === right.missed &&
    left.todo === right.todo &&
    left.future === right.future &&
    left.total === right.total
  );
}

function formatSummary(summary: ProgressSnapshot['summary']): string {
  return `done ${summary.done}, missed ${summary.missed}, todo ${summary.todo}, future ${summary.future}, total ${summary.total}`;
}

function codesKey(codes: string[]): string {
  return [...codes].sort().join(',');
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('src/research/runRecoveryPipeline.ts');
if (isDirectRun) {
  const report = runRecoveryPipeline();
  process.stdout.write(formatPipelineReport(report));
  if (report.assertion !== 'PASS') process.exitCode = 1;
}
