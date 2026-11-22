/**
 * Runs the rule baseline on the frozen phase-3A tasks and writes a separate log.
 * It does not read the manual plans, the clock, the network, or the database.
 *
 * From backend/:
 *   npx tsx src/research/runRuleExperiment.ts --recorded-at 2026-11-22T00:35:00.000Z
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadManualExperiment } from './experiment/manualExperiment.js';
import { RULE_EXPERIMENT_ID, evaluateRuleTasks } from './experiment/ruleExperiment.js';

const USAGE =
  'npx tsx src/research/runRuleExperiment.ts --recorded-at <ISO-8601 timestamp> [--out research-output/phase3b]';

function main() {
  const recordedAt = flag('--recorded-at');
  if (!recordedAt) {
    console.error(`Missing --recorded-at.\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  const directory = flag('--out') ?? join('research-output', 'phase3b');
  const tasks = loadManualExperiment().tasks.map(task => ({
    scenarioId: task.scenarioId,
    snapshot: task.snapshot,
    constraints: { dailyWorkloadLimitMinutes: task.constraints.dailyWorkloadLimitMinutes ?? null },
    expectedVerdict: null,
    requiredRecovery: task.requiredRecovery,
  }));
  const run = evaluateRuleTasks(tasks, { recordedAt, experimentId: RULE_EXPERIMENT_ID });
  mkdirSync(directory, { recursive: true });
  const tasksPath = join(directory, `${RULE_EXPERIMENT_ID}.tasks.json`);
  const resultsPath = join(directory, `${RULE_EXPERIMENT_ID}.results.jsonl`);
  const summaryPath = join(directory, `${RULE_EXPERIMENT_ID}.summary.json`);
  writeFileSync(
    tasksPath,
    `${JSON.stringify(
      {
        experimentId: RULE_EXPERIMENT_ID,
        recordedAt,
        reusableBy: ['manual', 'rule', 'direct_context_llm', 'mcp'],
        tasks: tasks.map(task => ({
          scenarioId: task.scenarioId,
          goalId: task.snapshot.goal.id,
          asOf: task.snapshot.asOf,
          snapshotVersion: task.snapshot.snapshotVersion,
          constraints: task.constraints,
          requiredRecovery: task.requiredRecovery,
          snapshot: task.snapshot,
        })),
      },
      null,
      2
    )}\n`
  );
  writeFileSync(resultsPath, `${run.results.map(result => JSON.stringify(result)).join('\n')}\n`);
  writeFileSync(summaryPath, `${JSON.stringify(run.summary, null, 2)}\n`);

  const planner = run.summary.planner;
  const verifier = run.summary.verifier;
  process.stdout.write(
    [
      `experiment ${run.summary.experimentId}`,
      `method ${run.summary.method}`,
      `recordedAt ${run.summary.recordedAt}`,
      `scenarios ${run.summary.scenarios}`,
      `planner PLAN_GENERATED ${planner.PLAN_GENERATED}`,
      `planner INSUFFICIENT_INFORMATION ${planner.INSUFFICIENT_INFORMATION}`,
      `planner INFEASIBLE ${planner.INFEASIBLE}`,
      `planner SEARCH_FAILED ${planner.SEARCH_FAILED}`,
      `verifier PASS ${verifier.PASS}`,
      `verifier FAIL ${verifier.FAIL}`,
      `verifier UNKNOWN ${verifier.UNKNOWN}`,
      `verifier notRun ${verifier.notRun}`,
      'unknown counted as pass: no',
      `raw coverage ${run.summary.rawCoverage.covered}/${run.summary.rawCoverage.required}`,
      `verified coverage ${run.summary.verifiedCoverage.covered}/${run.summary.verifiedCoverage.required}`,
      `recovery FULL ${run.summary.recoveryClass.FULL_RECOVERY}, PARTIAL ${run.summary.recoveryClass.PARTIAL_RECOVERY}, NONE ${run.summary.recoveryClass.NO_RECOVERY}, NOT_GENERATED ${run.summary.recoveryClass.NOT_GENERATED}`,
      `tasks ${tasksPath}`,
      `results ${resultsPath}`,
      `summary ${summaryPath}`,
      '',
    ].join('\n')
  );
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
}

main();
