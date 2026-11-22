/**
 * Counts whether a proposed plan reschedules a declared set of missed occurrences.
 * One on-or-after-asOf activity covers at most one required item for the same step.
 * The missed date itself does not count. Deadline and workload are not consulted.
 */

import type { RecoveryPlan } from '../../goals/verifyRecoveryPlan.js';
import type { RequiredRecoveryItem } from './requiredRecovery.js';

export type RecoveryCoverageStatus = 'COVERED' | 'PARTIAL' | 'NOT_COVERED' | 'NOT_REQUIRED';

export type RecoveryCoverage = {
  status: RecoveryCoverageStatus;
  required: RequiredRecoveryItem[];
  covered: RequiredRecoveryItem[];
  uncovered: RequiredRecoveryItem[];
};

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function measureRecoveryCoverage(input: {
  asOf: string;
  plan: RecoveryPlan;
  requiredRecovery: RequiredRecoveryItem[];
}): RecoveryCoverage {
  const required = input.requiredRecovery.map(item => ({ ...item }));
  const ordered = [...required].sort(
    (left, right) => left.missedDate.localeCompare(right.missedDate) || left.stepId.localeCompare(right.stepId)
  );
  const candidates = (input.plan.activities ?? [])
    .map((activity, index) => ({
      index,
      stepId: typeof activity?.stepId === 'string' ? activity.stepId.trim() : '',
      date: typeof activity?.date === 'string' ? activity.date : '',
    }))
    .filter(activity => activity.stepId !== '' && CIVIL_DATE.test(activity.date) && activity.date >= input.asOf)
    .sort((left, right) => left.date.localeCompare(right.date) || left.index - right.index);

  const used = new Set<number>();
  const covered: RequiredRecoveryItem[] = [];
  const uncovered: RequiredRecoveryItem[] = [];
  for (const item of ordered) {
    const match = candidates.findIndex(
      (candidate, index) => !used.has(index) && candidate.stepId === item.stepId && candidate.date !== item.missedDate
    );
    if (match === -1) uncovered.push({ ...item });
    else {
      used.add(match);
      covered.push({ ...item });
    }
  }

  const status: RecoveryCoverageStatus =
    required.length === 0
      ? 'NOT_REQUIRED'
      : covered.length === 0
        ? 'NOT_COVERED'
        : covered.length === required.length
          ? 'COVERED'
          : 'PARTIAL';

  return { status, required, covered, uncovered };
}
