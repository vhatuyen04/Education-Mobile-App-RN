/**
 * Direct-context prompt. The user message is the frozen task JSON.
 * Duration and start time are described as proposals, never as stored facts.
 * expectedVerdict from manual scenarios is not included.
 */

import { createHash } from 'node:crypto';

import type { ProgressSnapshot } from '../../goals/progressSnapshot.js';
import type { RecoveryConstraints, RecoveryPlan } from '../../goals/verifyRecoveryPlan.js';
import type { RequiredRecoveryItem } from '../experiment/requiredRecovery.js';
import type { LlmMessage } from './llmClient.js';

export const PROMPT_VERSION = 'tdk-recovery-prompt-v2';

export type RecoveryTaskView = {
  scenarioId: string;
  snapshot: ProgressSnapshot;
  constraints: RecoveryConstraints;
  requiredRecovery: RequiredRecoveryItem[];
};

const SYSTEM_PROMPT = [
  'You propose a RecoveryPlan for one goal. Return only one JSON object.',
  'Schema: {"goalId":"string","activities":[{"activityId":"string","stepId":"string","date":"YYYY-MM-DD","durationMinutes":number|null,"startMinuteOfDay":number|null}]}',
  'Copy goalId and stepId values exactly from the input.',
  'Hard constraints are binding: asOf, the goal deadline, the explicit dailyWorkloadLimitMinutes when it is a number, and every DONE date of a step you edit.',
  'durationMinutes and startMinuteOfDay are proposals you may include. They are not confirmed user facts. Omit them rather than pretending the user supplied them.',
  'Do not invent a daily workload limit, a deadline, a weekday for an ambiguous step, or a natural-language preference. optionalPreferences is null when the task has none.',
  'A plan that only repeats DONE dates is not recovery when requiredRecovery is non-empty.',
  'DONE means a self-report, not verified achievement.',
].join('\n');

export function snapshotHash(snapshot: ProgressSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export function buildInitialMessages(task: RecoveryTaskView): LlmMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(taskContext(task)) },
  ];
}

export function buildRevisionMessages(input: {
  task: RecoveryTaskView;
  previousRaw: string;
  previousPlan: RecoveryPlan | null;
  parseErrors: string[];
  verifierVerdict: string | null;
  violationCodes: string[];
  violationMessages: string[];
  notEvaluated: string[];
  notEvaluatedMessages: string[];
  uncovered: RequiredRecoveryItem[];
}): LlmMessage[] {
  return [
    ...buildInitialMessages(input.task),
    { role: 'assistant', content: input.previousRaw },
    {
      role: 'user',
      content: JSON.stringify({
        promptVersion: PROMPT_VERSION,
        kind: 'revision',
        instruction:
          'Return one corrected JSON RecoveryPlan. Do not invent dailyWorkloadLimitMinutes, a deadline, or a weekday. durationMinutes and startMinuteOfDay may be proposals only.',
        parseErrors: input.parseErrors,
        verifierVerdict: input.verifierVerdict,
        violationCodes: input.violationCodes,
        violationMessages: input.violationMessages,
        notEvaluated: input.notEvaluated,
        notEvaluatedMessages: input.notEvaluatedMessages,
        uncoveredRequiredRecovery: input.uncovered,
        previousPlan: input.previousPlan,
      }),
    },
  ];
}

function taskContext(task: RecoveryTaskView) {
  const snapshot = task.snapshot;
  const limit = task.constraints.dailyWorkloadLimitMinutes;
  return {
    promptVersion: PROMPT_VERSION,
    kind: 'initial',
    scenarioId: task.scenarioId,
    hardConstraints: {
      asOf: snapshot.asOf,
      deadline: snapshot.goal.deadline,
      dailyWorkloadLimitMinutes: typeof limit === 'number' ? limit : null,
      preserveDoneDates: 'If a step appears in the plan, every DONE date for that step must be copied unchanged.',
      newDates: 'On or after asOf, and on or before the deadline when a deadline exists.',
      allowedStepIds: snapshot.steps.map(step => step.id),
    },
    proposalsNotFacts: {
      durationMinutes: 'Optional proposal. The snapshot does not store a duration.',
      startMinuteOfDay: 'Optional proposal. The snapshot does not store a time of day.',
    },
    missingOrUnknown: snapshot.missing,
    optionalPreferences: null,
    goalDescription: null,
    requiredRecovery: task.requiredRecovery,
    occurrencesByStatus: {
      DONE: snapshot.occurrences.filter(item => item.status === 'DONE'),
      MISSED: snapshot.occurrences.filter(item => item.status === 'MISSED'),
      TODO: snapshot.occurrences.filter(item => item.status === 'TODO'),
      FUTURE: snapshot.occurrences.filter(item => item.status === 'FUTURE'),
    },
    snapshot,
  };
}
