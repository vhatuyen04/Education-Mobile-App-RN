/**
 * The manual phase-3A case list. Tasks freeze the snapshot and constraints.
 * Proposals are the hand-built plans. Later methods can load the same tasks
 * and replace only the proposals.
 */

import { buildFixtureProgressSnapshot } from '../buildFixtureSnapshot.js';
import { pipelineFixtures, pipelineScenarios } from '../fixtures/pipelineFixtures.js';
import type { ExperimentProposal, ExperimentTask } from './experimentRunner.js';
import { requiredRecoveryFor } from './requiredRecovery.js';

export const MANUAL_EXPERIMENT_ID = 'phase3a-manual';

export function loadManualExperiment(): { tasks: ExperimentTask[]; proposals: ExperimentProposal[] } {
  const snapshots = new Map(pipelineFixtures.map(fixture => [fixture.goal.id, buildFixtureProgressSnapshot(fixture)]));
  const tasks: ExperimentTask[] = [];
  const proposals: ExperimentProposal[] = [];
  for (const scenario of pipelineScenarios) {
    const snapshot = snapshots.get(scenario.goalId);
    if (!snapshot) throw new Error(`No snapshot for ${scenario.goalId}`);
    tasks.push({
      scenarioId: scenario.id,
      snapshot,
      constraints: scenario.constraints,
      expectedVerdict: scenario.expectedVerdict,
      requiredRecovery: requiredRecoveryFor(scenario.id),
    });
    proposals.push({
      scenarioId: scenario.id,
      planId: `manual:${scenario.id}`,
      method: 'manual',
      plan: scenario.plan,
    });
  }
  return { tasks, proposals };
}
