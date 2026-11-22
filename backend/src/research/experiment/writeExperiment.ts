import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXPERIMENT_METHODS, type ExperimentRun } from './experimentRunner.js';

export type ExperimentOutputPaths = {
  directory: string;
  tasks: string;
  proposals: string;
  results: string;
  summary: string;
};

export function writeExperimentOutput(directory: string, run: ExperimentRun): ExperimentOutputPaths {
  mkdirSync(directory, { recursive: true });
  const id = run.summary.experimentId;
  const paths: ExperimentOutputPaths = {
    directory,
    tasks: join(directory, `${id}.tasks.json`),
    proposals: join(directory, `${id}.proposals.json`),
    results: join(directory, `${id}.results.jsonl`),
    summary: join(directory, `${id}.summary.json`),
  };
  writeFileSync(paths.tasks, `${JSON.stringify(tasksDocument(run), null, 2)}\n`);
  writeFileSync(paths.proposals, `${JSON.stringify(proposalsDocument(run), null, 2)}\n`);
  writeFileSync(paths.results, `${run.records.map(record => JSON.stringify(record)).join('\n')}\n`);
  writeFileSync(paths.summary, `${JSON.stringify(run.summary, null, 2)}\n`);
  return paths;
}

function tasksDocument(run: ExperimentRun) {
  return {
    experimentId: run.summary.experimentId,
    recordedAt: run.summary.recordedAt,
    reusableBy: [...EXPERIMENT_METHODS],
    tasks: run.tasks.map(task => ({
      scenarioId: task.scenarioId,
      goalId: task.snapshot.goal.id,
      asOf: task.snapshot.asOf,
      snapshotVersion: task.snapshot.snapshotVersion,
      constraints: task.constraints,
      expectedVerdict: task.expectedVerdict,
      requiredRecovery: task.requiredRecovery,
      snapshot: task.snapshot,
    })),
  };
}

function proposalsDocument(run: ExperimentRun) {
  return {
    experimentId: run.summary.experimentId,
    recordedAt: run.summary.recordedAt,
    proposals: run.proposals.map(proposal => ({
      scenarioId: proposal.scenarioId,
      planId: proposal.planId,
      method: proposal.method,
      plan: proposal.plan,
    })),
  };
}
