/**
 * Deterministic check of a proposed recovery plan against one progress snapshot.
 *
 * DONE means a self-reported completion row, not a verified achievement.
 * A check that lacks duration, time-of-day, workload, or a deadline is
 * NOT_EVALUATED. The verdict is UNKNOWN in that case, never PASS.
 * Any confirmed violation makes the verdict FAIL, including when other checks
 * could not be evaluated.
 */

import type { ProgressSnapshot } from './progressSnapshot.js';

export type RecoveryActivity = {
  activityId: string;
  stepId: string;
  date: string;
  durationMinutes?: number | null;
  startMinuteOfDay?: number | null;
};

export type RecoveryPlan = {
  goalId: string;
  activities: RecoveryActivity[];
};

export type RecoveryConstraints = {
  /** Explicit cap supplied by the experiment. Null or omitted cannot be evaluated. */
  dailyWorkloadLimitMinutes?: number | null;
};

export type CheckStatus = 'PASS' | 'FAIL' | 'NOT_EVALUATED';

export type VerificationCheck = {
  code:
    | 'PLAN_SHAPE'
    | 'STEP_IDS'
    | 'PRESERVE_DONE'
    | 'NOT_IN_PAST'
    | 'DEADLINE'
    | 'TIME_CONFLICT'
    | 'WORKLOAD'
    | 'SCHEDULE_KNOWN';
  status: CheckStatus;
  message: string;
};

export type VerificationViolation = {
  code:
    | 'GOAL_MISMATCH'
    | 'MALFORMED_ACTIVITY'
    | 'MALFORMED_DATE'
    | 'DUPLICATE_ACTIVITY'
    | 'DUPLICATE_OCCURRENCE'
    | 'UNKNOWN_STEP'
    | 'DONE_DROPPED'
    | 'PAST_DATE'
    | 'AFTER_DEADLINE'
    | 'NO_FEASIBLE_DATE'
    | 'TIME_CONFLICT'
    | 'TIME_SLOT_OUT_OF_DAY'
    | 'WORKLOAD_EXCEEDED';
  path: string;
  message: string;
};

export type VerificationResult = {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  progressMeaning: 'self_report_not_verified_achievement';
  checks: VerificationCheck[];
  violations: VerificationViolation[];
  notEvaluated: VerificationCheck[];
};

type WellFormedActivity = {
  index: number;
  activityId: string;
  stepId: string;
  date: string;
  durationMinutes: number | null;
  startMinuteOfDay: number | null;
};

export function verifyRecoveryPlan(
  snapshot: ProgressSnapshot,
  proposedPlan: RecoveryPlan,
  constraints: RecoveryConstraints = {}
): VerificationResult {
  const violations: VerificationViolation[] = [];
  const activities = proposedPlan.activities ?? [];
  const seenIds = new Set<string>();
  const seenOccurrence = new Set<string>();
  const wellFormed: WellFormedActivity[] = [];

  if (proposedPlan.goalId !== snapshot.goal.id) {
    violations.push({
      code: 'GOAL_MISMATCH',
      path: 'goalId',
      message: `Plan goal ${proposedPlan.goalId || '(empty)'} does not match snapshot goal ${snapshot.goal.id}.`,
    });
  }

  activities.forEach((activity, index) => {
    const path = `activities[${index}]`;
    const activityId = typeof activity?.activityId === 'string' ? activity.activityId.trim() : '';
    const stepId = typeof activity?.stepId === 'string' ? activity.stepId.trim() : '';
    const date = typeof activity?.date === 'string' ? activity.date : '';
    if (!activityId || !stepId) {
      violations.push({
        code: 'MALFORMED_ACTIVITY',
        path,
        message: 'Each activity needs a non-empty activityId and stepId.',
      });
      return;
    }
    if (seenIds.has(activityId)) {
      violations.push({
        code: 'DUPLICATE_ACTIVITY',
        path: `${path}.activityId`,
        message: `Activity id ${activityId} is used more than once.`,
      });
      return;
    }
    seenIds.add(activityId);
    if (!isCivilDate(date)) {
      violations.push({
        code: 'MALFORMED_DATE',
        path: `${path}.date`,
        message: `Date ${date || '(empty)'} is not a real YYYY-MM-DD civil date.`,
      });
      return;
    }
    const occurrenceKey = `${stepId}|${date}`;
    if (seenOccurrence.has(occurrenceKey)) {
      violations.push({
        code: 'DUPLICATE_OCCURRENCE',
        path,
        message: `Step ${stepId} is proposed twice on ${date}.`,
      });
      return;
    }
    seenOccurrence.add(occurrenceKey);

    const duration = readOptionalMinutes(activity.durationMinutes);
    const start = readOptionalMinuteOfDay(activity.startMinuteOfDay);
    if (duration === 'invalid' || start === 'invalid') {
      violations.push({
        code: 'MALFORMED_ACTIVITY',
        path,
        message: 'durationMinutes must be a positive integer and startMinuteOfDay must be an integer from 0 through 1439 when provided.',
      });
      return;
    }
    wellFormed.push({
      index,
      activityId,
      stepId,
      date,
      durationMinutes: duration,
      startMinuteOfDay: start,
    });
  });

  const stepById = new Map(snapshot.steps.map(step => [step.id, step]));
  for (const activity of wellFormed) {
    if (!stepById.has(activity.stepId)) {
      violations.push({
        code: 'UNKNOWN_STEP',
        path: `activities[${activity.index}].stepId`,
        message: `Step ${activity.stepId} is not on this goal.`,
      });
    }
  }

  const doneByStep = new Map<string, string[]>();
  for (const occurrence of snapshot.occurrences) {
    if (occurrence.status !== 'DONE') continue;
    const dates = doneByStep.get(occurrence.stepId) ?? [];
    dates.push(occurrence.date);
    doneByStep.set(occurrence.stepId, dates);
  }
  const plannedByStep = new Map<string, Set<string>>();
  for (const activity of wellFormed) {
    if (!stepById.has(activity.stepId)) continue;
    const dates = plannedByStep.get(activity.stepId) ?? new Set<string>();
    dates.add(activity.date);
    plannedByStep.set(activity.stepId, dates);
  }
  for (const [stepId, doneDates] of doneByStep) {
    const planned = plannedByStep.get(stepId);
    if (!planned) continue;
    for (const date of doneDates) {
      if (!planned.has(date)) {
        violations.push({
          code: 'DONE_DROPPED',
          path: `steps/${stepId}/dates/${date}`,
          message: `The self-reported completion on ${date} for step ${stepId} is missing from the plan.`,
        });
      }
    }
  }

  for (const activity of wellFormed) {
    if (activity.date < snapshot.asOf && !isPreservedDone(snapshot, activity.stepId, activity.date)) {
      violations.push({
        code: 'PAST_DATE',
        path: `activities[${activity.index}].date`,
        message: `${activity.date} is before ${snapshot.asOf}. Only an already reported DONE occurrence may stay on a past date.`,
      });
    }
  }

  const deadline = snapshot.goal.deadline;
  const deadlineKnown = deadline != null && isCivilDate(deadline);
  if (deadlineKnown && deadline != null && deadline < snapshot.asOf) {
    const addsWork = wellFormed.some(activity => !isPreservedDone(snapshot, activity.stepId, activity.date));
    if (addsWork) {
      violations.push({
        code: 'NO_FEASIBLE_DATE',
        path: 'goal.deadline',
        message: `Deadline ${deadline} is already before ${snapshot.asOf}, so no new activity can be both today-or-later and on or before the deadline.`,
      });
    }
  }
  if (deadlineKnown && deadline != null) {
    for (const activity of wellFormed) {
      if (activity.date > deadline) {
        violations.push({
          code: 'AFTER_DEADLINE',
          path: `activities[${activity.index}].date`,
          message: `${activity.date} is after the goal deadline ${deadline}.`,
        });
      }
    }
  }

  const slotsKnown = wellFormed.every(
    activity => activity.durationMinutes != null && activity.startMinuteOfDay != null
  );
  if (wellFormed.length >= 2 && slotsKnown) {
    const byDate = new Map<string, WellFormedActivity[]>();
    for (const activity of wellFormed) {
      const group = byDate.get(activity.date) ?? [];
      group.push(activity);
      byDate.set(activity.date, group);
    }
    for (const group of byDate.values()) {
      const ordered = [...group].sort(
        (a, b) => (a.startMinuteOfDay as number) - (b.startMinuteOfDay as number) || a.index - b.index
      );
      for (const activity of ordered) {
        const end = (activity.startMinuteOfDay as number) + (activity.durationMinutes as number);
        if (end > 1440) {
          violations.push({
            code: 'TIME_SLOT_OUT_OF_DAY',
            path: `activities[${activity.index}]`,
            message: `The slot starting at minute ${activity.startMinuteOfDay} runs past the end of ${activity.date}.`,
          });
        }
      }
      for (let i = 1; i < ordered.length; i += 1) {
        const previous = ordered[i - 1];
        const current = ordered[i];
        const previousEnd = (previous.startMinuteOfDay as number) + (previous.durationMinutes as number);
        if ((current.startMinuteOfDay as number) < previousEnd) {
          violations.push({
            code: 'TIME_CONFLICT',
            path: `activities[${current.index}]`,
            message: `${current.stepId} on ${current.date} overlaps ${previous.stepId}.`,
          });
        }
      }
    }
  }

  const limit = constraints.dailyWorkloadLimitMinutes;
  const limitKnown = typeof limit === 'number' && Number.isInteger(limit) && limit >= 0;
  const durationsKnown = wellFormed.every(activity => activity.durationMinutes != null);
  if (limitKnown && durationsKnown && wellFormed.length > 0) {
    const minutes = new Map<string, number>();
    for (const activity of wellFormed) {
      minutes.set(activity.date, (minutes.get(activity.date) ?? 0) + (activity.durationMinutes as number));
    }
    for (const [date, total] of [...minutes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (total > (limit as number)) {
        violations.push({
          code: 'WORKLOAD_EXCEEDED',
          path: `dates/${date}`,
          message: `${date} proposes ${total} minutes, above the explicit daily limit of ${limit}.`,
        });
      }
    }
  }

  const referenced = new Set(wellFormed.map(activity => activity.stepId));
  const ambiguous = [...referenced].filter(stepId => {
    const step = stepById.get(stepId);
    return step != null && step.occurrenceStatus !== 'scheduled';
  });

  const shapeFailed = violations.some(item =>
    item.code === 'GOAL_MISMATCH' ||
    item.code === 'MALFORMED_ACTIVITY' ||
    item.code === 'MALFORMED_DATE' ||
    item.code === 'DUPLICATE_ACTIVITY' ||
    item.code === 'DUPLICATE_OCCURRENCE'
  );
  const checks: VerificationCheck[] = [
    {
      code: 'PLAN_SHAPE',
      status: shapeFailed ? 'FAIL' : 'PASS',
      message: shapeFailed ? 'The plan has a malformed, duplicate, or mismatched entry.' : 'Activity ids, dates, and the goal id are well formed.',
    },
    {
      code: 'STEP_IDS',
      status: violations.some(item => item.code === 'UNKNOWN_STEP') ? 'FAIL' : 'PASS',
      message: violations.some(item => item.code === 'UNKNOWN_STEP')
        ? 'The plan names a step that is not on this goal.'
        : 'Every proposed step id belongs to this goal.',
    },
    {
      code: 'PRESERVE_DONE',
      status: violations.some(item => item.code === 'DONE_DROPPED') ? 'FAIL' : 'PASS',
      message: violations.some(item => item.code === 'DONE_DROPPED')
        ? 'A step the plan edits is missing a previously reported DONE date.'
        : 'Reported DONE dates for edited steps are still present. Untouched steps are left as recorded.',
    },
    {
      code: 'NOT_IN_PAST',
      status: violations.some(item => item.code === 'PAST_DATE') ? 'FAIL' : 'PASS',
      message: violations.some(item => item.code === 'PAST_DATE')
        ? 'A new activity is dated before asOf.'
        : 'New activities are on asOf or later. Past dates appear only as preserved DONE reports.',
    },
    deadlineKnown
      ? {
          code: 'DEADLINE',
          status: violations.some(item => item.code === 'AFTER_DEADLINE' || item.code === 'NO_FEASIBLE_DATE') ? 'FAIL' : 'PASS',
          message: violations.some(item => item.code === 'AFTER_DEADLINE' || item.code === 'NO_FEASIBLE_DATE')
            ? 'An activity falls outside the goal deadline, or the deadline leaves no feasible date.'
            : `Every activity is on or before ${deadline}.`,
        }
      : {
          code: 'DEADLINE',
          status: 'NOT_EVALUATED',
          message: 'This goal has no deadline, so the deadline check cannot be completed.',
        },
    wellFormed.length < 2
      ? {
          code: 'TIME_CONFLICT',
          status: 'PASS',
          message: 'Fewer than two activities, so no pair can overlap.',
        }
      : slotsKnown
        ? {
            code: 'TIME_CONFLICT',
            status: violations.some(item => item.code === 'TIME_CONFLICT' || item.code === 'TIME_SLOT_OUT_OF_DAY') ? 'FAIL' : 'PASS',
            message: violations.some(item => item.code === 'TIME_CONFLICT' || item.code === 'TIME_SLOT_OUT_OF_DAY')
              ? 'Two activities overlap, or a slot runs past the end of the day.'
              : 'Explicit time slots do not overlap.',
          }
        : {
            code: 'TIME_CONFLICT',
            status: 'NOT_EVALUATED',
            message: 'At least one activity has no startMinuteOfDay or durationMinutes, so overlap cannot be judged.',
          },
    !limitKnown
      ? {
          code: 'WORKLOAD',
          status: 'NOT_EVALUATED',
          message: 'No explicit non-negative integer dailyWorkloadLimitMinutes was supplied.',
        }
      : !durationsKnown
        ? {
            code: 'WORKLOAD',
            status: 'NOT_EVALUATED',
            message: 'The daily limit is present, but at least one activity has no durationMinutes.',
          }
        : {
            code: 'WORKLOAD',
            status: violations.some(item => item.code === 'WORKLOAD_EXCEEDED') ? 'FAIL' : 'PASS',
            message: violations.some(item => item.code === 'WORKLOAD_EXCEEDED')
              ? 'A date exceeds the explicit daily minute limit.'
              : `Each date is within ${limit} minutes.`,
          },
    ambiguous.length > 0
      ? {
          code: 'SCHEDULE_KNOWN',
          status: 'NOT_EVALUATED',
          message: `These steps have no definite schedule: ${ambiguous.join(', ')}.`,
        }
      : {
          code: 'SCHEDULE_KNOWN',
          status: 'PASS',
          message: 'Every referenced step has a definite schedule, or the plan references none.',
        },
  ];

  const notEvaluated = checks.filter(check => check.status === 'NOT_EVALUATED');
  const failed = checks.some(check => check.status === 'FAIL') || violations.length > 0;
  const verdict = failed ? 'FAIL' : notEvaluated.length > 0 ? 'UNKNOWN' : 'PASS';

  return {
    verdict,
    progressMeaning: 'self_report_not_verified_achievement',
    checks,
    violations,
    notEvaluated,
  };
}

function isPreservedDone(snapshot: ProgressSnapshot, stepId: string, date: string): boolean {
  return snapshot.occurrences.some(
    occurrence => occurrence.stepId === stepId && occurrence.date === date && occurrence.status === 'DONE'
  );
}

function readOptionalMinutes(value: number | null | undefined): number | null | 'invalid' {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return 'invalid';
  return value;
}

function readOptionalMinuteOfDay(value: number | null | undefined): number | null | 'invalid' {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1439) return 'invalid';
  return value;
}

function isCivilDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
