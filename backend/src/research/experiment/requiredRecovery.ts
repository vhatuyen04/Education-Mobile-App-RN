/**
 * Missed occurrences the experiment wants a recovery method to reschedule.
 *
 * This list is not an input to verifyRecoveryPlan. A plan can PASS every
 * constraint while leaving these dates uncovered.
 */

import { STEP_FRI_ID, STEP_IMPLEMENT_ID, STEP_STUDY_ID } from '../fixtures/pipelineFixtures.js';

export type RequiredRecoveryItem = {
  stepId: string;
  missedDate: string;
};

const STUDY_MISSES: RequiredRecoveryItem[] = [
  { stepId: STEP_STUDY_ID, missedDate: '2026-11-19' },
  { stepId: STEP_STUDY_ID, missedDate: '2026-11-20' },
];

const IMPLEMENT_MISS: RequiredRecoveryItem[] = [
  { stepId: STEP_IMPLEMENT_ID, missedDate: '2026-11-20' },
];

const FRIDAY_MISS: RequiredRecoveryItem[] = [
  { stepId: STEP_FRI_ID, missedDate: '2026-11-20' },
];

const NONE: RequiredRecoveryItem[] = [];

/** One entry per pipeline scenario. An empty list means coverage is not required. */
export const REQUIRED_RECOVERY_BY_SCENARIO: Record<string, RequiredRecoveryItem[]> = {
  'goal-a-valid-recovery': STUDY_MISSES,
  'goal-a-after-deadline': STUDY_MISSES,
  'goal-a-past-date': STUDY_MISSES,
  'goal-a-done-dropped': STUDY_MISSES,
  'goal-a-unknown-step': STUDY_MISSES,
  'goal-a-duplicate-activity': STUDY_MISSES,
  'goal-a-missing-constraints': STUDY_MISSES,
  'goal-a-constraints-without-recovery': STUDY_MISSES,
  'goal-b-workload': IMPLEMENT_MISS,
  'goal-b-time-conflict': IMPLEMENT_MISS,
  'goal-c-off-schedule-completion': FRIDAY_MISS,
  'goal-d-ambiguous-schedule': NONE,
  'goal-e-synthetic-conflict': NONE,
};

export function requiredRecoveryFor(scenarioId: string): RequiredRecoveryItem[] {
  if (!Object.prototype.hasOwnProperty.call(REQUIRED_RECOVERY_BY_SCENARIO, scenarioId)) {
    throw new Error(`No required-recovery set is defined for scenario ${scenarioId}`);
  }
  return REQUIRED_RECOVERY_BY_SCENARIO[scenarioId].map(item => ({ ...item }));
}
