/**
 * Builds one progress snapshot from a Prisma-shaped research fixture.
 * The field selection matches the read-only snapshot command.
 */

import { mapStoredGoalToSnapshotInput } from '../goals/mapProgressSnapshotRows.js';
import { buildProgressSnapshot, type ProgressSnapshot } from '../goals/progressSnapshot.js';
import { PIPELINE_AS_OF, PIPELINE_TIME_ZONE, type PipelineFixture } from './fixtures/pipelineFixtures.js';

export function buildFixtureProgressSnapshot(fixture: PipelineFixture): ProgressSnapshot {
  const mapped = mapStoredGoalToSnapshotInput({
    goal: {
      id: fixture.goal.id,
      title: fixture.goal.title,
      createdAt: fixture.goal.createdAt,
      dueAt: fixture.goal.dueAt,
      completed: fixture.goal.completed,
      failedAt: fixture.goal.failedAt,
    },
    steps: fixture.steps.map(row => ({
      id: row.id,
      order: row.order,
      text: row.text,
      description: row.description,
      dueAt: row.dueAt,
      repeat: row.repeat,
      repeatDay: row.repeatDay,
      repeatMonth: row.repeatMonth,
    })),
    completions: fixture.completions.map(row => ({ stepId: row.stepId, date: row.date })),
    timeZone: PIPELINE_TIME_ZONE,
  });
  return buildProgressSnapshot({ ...mapped, asOf: PIPELINE_AS_OF });
}
