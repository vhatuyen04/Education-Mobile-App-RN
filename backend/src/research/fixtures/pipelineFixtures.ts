/**
 * In-memory Goal, GoalStep, and GoalStepCompletion rows for the recovery pipeline.
 *
 * These rows are not inserted. November 2026 in Europe/Budapest is CET (UTC+1)
 * after the 2026-10-25 daylight-saving fallback. Instants are built with
 * Date.UTC minus that fixed offset. The host zone and the clock are not used.
 *
 * Completion `date` is the server-local midnight written by
 * POST /auth/goals/:goalId/steps/:stepId/completion (`startOfLocalDay`).
 * One-time step `dueAt` and goal `dueAt` are the local 23:59:59.999 instant
 * the Goal Detail and AI planner screens send. `createdAt` is an ordinary
 * daytime instant, which is what `@default(now())` stores.
 *
 * Custom goals go through classifyCreatedGoal(null), so pointsAwarded and
 * xpAwarded are 0. That is the handler's write, not the unused schema
 * defaults of 1 and 50. GoalStep.done stays false because no handler writes it.
 *
 * Category A rows are states the current screens can save.
 * Category B is a column combination the step handler would store if a client
 * sent it, and which neither Goal Detail nor the AI planner save path sends.
 */

import type { Goal, GoalStep, GoalStepCompletion } from '@prisma/client';

import type { RecoveryConstraints, RecoveryPlan } from '../../goals/verifyRecoveryPlan.js';

export const PIPELINE_TIME_ZONE = 'Europe/Budapest';
export const PIPELINE_AS_OF = '2026-11-21';
export const FIXTURE_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

const CET_OFFSET_MS = 60 * 60 * 1000;

/** Wall-clock instant in Europe/Budapest during November 2026 only. */
export function budapestNovember2026(civilDate: string, hour: number, minute = 0, second = 0, ms = 0): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civilDate);
  if (!match) throw new Error(`civil date must be YYYY-MM-DD: ${civilDate}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year !== 2026 || month !== 11) {
    throw new Error('this offset is valid only for November 2026 CET');
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms) - CET_OFFSET_MS);
}

export function budapestMidnight(civilDate: string): Date {
  return budapestNovember2026(civilDate, 0, 0, 0, 0);
}

export function budapestEndOfDay(civilDate: string): Date {
  return budapestNovember2026(civilDate, 23, 59, 59, 999);
}

export const GOAL_A_ID = '11111111-1111-4111-8111-111111111111';
export const STEP_STUDY_ID = '11111111-1111-4111-8111-1111111111a1';

export const GOAL_B_ID = '22222222-2222-4222-8222-222222222222';
export const STEP_DIAGRAM_ID = '22222222-2222-4222-8222-2222222222b1';
export const STEP_IMPLEMENT_ID = '22222222-2222-4222-8222-2222222222b2';
export const STEP_TESTS_ID = '22222222-2222-4222-8222-2222222222b3';
export const STEP_SUBMIT_ID = '22222222-2222-4222-8222-2222222222b4';

export const GOAL_C_ID = '33333333-3333-4333-8333-333333333333';
export const STEP_MON_ID = '33333333-3333-4333-8333-3333333333c1';
export const STEP_WED_ID = '33333333-3333-4333-8333-3333333333c2';
export const STEP_FRI_ID = '33333333-3333-4333-8333-3333333333c3';

export const GOAL_D_ID = '44444444-4444-4444-8444-444444444444';
export const STEP_AMBIGUOUS_ID = '44444444-4444-4444-8444-4444444444d1';

export const GOAL_E_ID = '55555555-5555-4555-8555-555555555555';
export const STEP_CONFLICT_ID = '55555555-5555-4555-8555-5555555555e1';

export type FixtureCategory = 'application-realistic' | 'synthetic-edge';

export type OccurrenceExpectation = {
  stepId: string;
  date: string;
  status: 'DONE' | 'MISSED' | 'TODO' | 'FUTURE';
};

export type SummaryExpectation = {
  done: number;
  missed: number;
  todo: number;
  future: number;
  total: number;
};

export type PipelineFixture = {
  category: FixtureCategory;
  producedBy: string;
  goal: Goal;
  steps: GoalStep[];
  completions: GoalStepCompletion[];
  expectedSummary: SummaryExpectation;
  expectedOccurrences: OccurrenceExpectation[];
  expectedUnscheduled: Array<{ stepId: string; date: string; reason: string }>;
  expectedAmbiguous: Array<{ stepId: string; reason: string }>;
};

export type PipelineScenario = {
  id: string;
  category: FixtureCategory;
  goalId: string;
  note: string;
  /** Written before the verifier runs. */
  expectedVerdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  expectedViolationCodes: string[];
  expectedNotEvaluated: string[];
  /**
   * True when the plan adds an asOf-or-later activity for a step that has a
   * MISSED occurrence. False when it does not. Null when this scenario is
   * not a usefulness check. Constraint PASS does not imply true.
   */
  expectRecoversMissedWork: boolean | null;
  plan: RecoveryPlan;
  constraints: RecoveryConstraints;
};

const CREATED = budapestNovember2026('2026-11-16', 18, 42, 0, 0);
const STEP_WRITTEN = budapestNovember2026('2026-11-16', 18, 43, 0, 0);
const DEADLINE = budapestEndOfDay('2026-11-28');

function customGoal(input: {
  id: string;
  title: string;
  description: string;
  updatedAt?: Date;
}): Goal {
  return {
    id: input.id,
    userId: FIXTURE_USER_ID,
    title: input.title,
    description: input.description,
    requirement: null,
    expectation: null,
    requirementSource: 'USER',
    rankField: null,
    progressPct: 0,
    dueAt: DEADLINE,
    completed: false,
    completedAt: null,
    difficultyScore: null,
    difficultyConfidence: null,
    difficultyReason: null,
    pointsAwarded: 0,
    xpAwarded: 0,
    rankingEligible: false,
    rankingEligibilityReason: null,
    deletedAt: null,
    failedAt: null,
    failedReason: null,
    createdAt: CREATED,
    updatedAt: input.updatedAt ?? CREATED,
  };
}

function step(input: {
  id: string;
  goalId: string;
  text: string;
  order: number;
  dueAt?: Date | null;
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}): GoalStep {
  const createdAt = input.createdAt ?? STEP_WRITTEN;
  return {
    id: input.id,
    goalId: input.goalId,
    text: input.text,
    description: null,
    order: input.order,
    dueAt: input.dueAt ?? null,
    repeat: input.repeat ?? null,
    repeatDay: input.repeatDay ?? null,
    repeatMonth: input.repeatMonth ?? null,
    repeatDays: [],
    durationMinutes: null,
    archivedAt: null,
    effectiveFrom: null,
    effectiveUntil: null,
    replacesStepId: null,
    customDates: [],
    done: false,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}

function completion(id: string, stepId: string, civilDate: string): GoalStepCompletion {
  return {
    id,
    stepId,
    date: budapestMidnight(civilDate),
    createdAt: budapestNovember2026(civilDate, 20, 5, 0, 0),
  };
}

function occurrence(stepId: string, date: string, status: OccurrenceExpectation['status']): OccurrenceExpectation {
  return { stepId, date, status };
}

const studyDone = ['2026-11-16', '2026-11-17', '2026-11-18'] as const;

export const goalA: PipelineFixture = {
  category: 'application-realistic',
  producedBy:
    'POST /auth/goals from Goal Detail (custom goal, deadline YYYY-MM-DD saved as local 23:59:59.999). POST /auth/goals/:id/steps with the schedule text "daily". POST completion from Today Details on 16, 17, and 18 Nov; 19 and 20 Nov were left unmarked.',
  goal: customGoal({
    id: GOAL_A_ID,
    title: 'Learn Java Every Day',
    description: 'Study Java once a day until the deadline.',
  }),
  steps: [
    step({
      id: STEP_STUDY_ID,
      goalId: GOAL_A_ID,
      text: 'Study Java',
      order: 0,
      repeat: 'daily',
    }),
  ],
  completions: [
    completion('11111111-1111-4111-8111-111111111c16', STEP_STUDY_ID, '2026-11-16'),
    completion('11111111-1111-4111-8111-111111111c17', STEP_STUDY_ID, '2026-11-17'),
    completion('11111111-1111-4111-8111-111111111c18', STEP_STUDY_ID, '2026-11-18'),
  ],
  expectedSummary: { done: 3, missed: 2, todo: 1, future: 7, total: 13 },
  expectedOccurrences: [
    occurrence(STEP_STUDY_ID, '2026-11-16', 'DONE'),
    occurrence(STEP_STUDY_ID, '2026-11-17', 'DONE'),
    occurrence(STEP_STUDY_ID, '2026-11-18', 'DONE'),
    occurrence(STEP_STUDY_ID, '2026-11-19', 'MISSED'),
    occurrence(STEP_STUDY_ID, '2026-11-20', 'MISSED'),
    occurrence(STEP_STUDY_ID, '2026-11-21', 'TODO'),
    occurrence(STEP_STUDY_ID, '2026-11-22', 'FUTURE'),
    occurrence(STEP_STUDY_ID, '2026-11-23', 'FUTURE'),
    occurrence(STEP_STUDY_ID, '2026-11-24', 'FUTURE'),
    occurrence(STEP_STUDY_ID, '2026-11-25', 'FUTURE'),
    occurrence(STEP_STUDY_ID, '2026-11-26', 'FUTURE'),
    occurrence(STEP_STUDY_ID, '2026-11-27', 'FUTURE'),
    occurrence(STEP_STUDY_ID, '2026-11-28', 'FUTURE'),
  ],
  expectedUnscheduled: [],
  expectedAmbiguous: [],
};

export const goalB: PipelineFixture = {
  category: 'application-realistic',
  producedBy:
    'POST /auth/goals from Goal Detail. Four steps saved with schedule text once:YYYY-MM-DD, which stores dueAt at local 23:59:59.999 and leaves repeat null. Today Details can mark a one-time step only on its due day, so the class-diagram completion is 18 Nov midnight. The other three steps were never marked.',
  goal: customGoal({
    id: GOAL_B_ID,
    title: 'Complete Java OOP Project',
    description: 'Finish the class diagram, the code, the tests, and the submission.',
  }),
  steps: [
    step({
      id: STEP_DIAGRAM_ID,
      goalId: GOAL_B_ID,
      text: 'Sketch the class diagram',
      order: 0,
      dueAt: budapestEndOfDay('2026-11-18'),
    }),
    step({
      id: STEP_IMPLEMENT_ID,
      goalId: GOAL_B_ID,
      text: 'Implement the classes',
      order: 1,
      dueAt: budapestEndOfDay('2026-11-20'),
    }),
    step({
      id: STEP_TESTS_ID,
      goalId: GOAL_B_ID,
      text: 'Write unit tests',
      order: 2,
      dueAt: budapestEndOfDay('2026-11-21'),
    }),
    step({
      id: STEP_SUBMIT_ID,
      goalId: GOAL_B_ID,
      text: 'Submit the project',
      order: 3,
      dueAt: budapestEndOfDay('2026-11-27'),
    }),
  ],
  completions: [completion('22222222-2222-4222-8222-222222222c18', STEP_DIAGRAM_ID, '2026-11-18')],
  expectedSummary: { done: 1, missed: 1, todo: 1, future: 1, total: 4 },
  expectedOccurrences: [
    occurrence(STEP_DIAGRAM_ID, '2026-11-18', 'DONE'),
    occurrence(STEP_IMPLEMENT_ID, '2026-11-20', 'MISSED'),
    occurrence(STEP_TESTS_ID, '2026-11-21', 'TODO'),
    occurrence(STEP_SUBMIT_ID, '2026-11-27', 'FUTURE'),
  ],
  expectedUnscheduled: [],
  expectedAmbiguous: [],
};

export const goalC: PipelineFixture = {
  category: 'application-realistic',
  producedBy:
    'POST /auth/goals from Goal Detail. Monday and Wednesday steps saved as weekly:Mon and weekly:Wed (repeatDay 1 and 3; Sunday is 0). Both were marked from Today Details on those weekdays. The Friday step was first saved as weekly:Thu, marked done on Thursday 19 Nov, then PUT /auth/goals/:goalId/steps/:stepId changed repeatDay to 5. That update does not delete completion rows, so 19 Nov remains on a step whose current weekday is Friday.',
  goal: customGoal({
    id: GOAL_C_ID,
    title: 'Practice Java Three Days a Week',
    description: 'Practice on Monday, Wednesday, and Friday.',
  }),
  steps: [
    step({
      id: STEP_MON_ID,
      goalId: GOAL_C_ID,
      text: 'Review Java syntax',
      order: 0,
      repeat: 'weekly',
      repeatDay: 1,
    }),
    step({
      id: STEP_WED_ID,
      goalId: GOAL_C_ID,
      text: 'Solve practice exercises',
      order: 1,
      repeat: 'weekly',
      repeatDay: 3,
    }),
    step({
      id: STEP_FRI_ID,
      goalId: GOAL_C_ID,
      text: "Review the week's mistakes",
      order: 2,
      repeat: 'weekly',
      repeatDay: 5,
      updatedAt: budapestNovember2026('2026-11-20', 9, 12, 0, 0),
    }),
  ],
  completions: [
    completion('33333333-3333-4333-8333-333333333c16', STEP_MON_ID, '2026-11-16'),
    completion('33333333-3333-4333-8333-333333333c18', STEP_WED_ID, '2026-11-18'),
    completion('33333333-3333-4333-8333-333333333c19', STEP_FRI_ID, '2026-11-19'),
  ],
  expectedSummary: { done: 2, missed: 1, todo: 0, future: 3, total: 6 },
  expectedOccurrences: [
    occurrence(STEP_MON_ID, '2026-11-16', 'DONE'),
    occurrence(STEP_WED_ID, '2026-11-18', 'DONE'),
    occurrence(STEP_FRI_ID, '2026-11-20', 'MISSED'),
    occurrence(STEP_MON_ID, '2026-11-23', 'FUTURE'),
    occurrence(STEP_WED_ID, '2026-11-25', 'FUTURE'),
    occurrence(STEP_FRI_ID, '2026-11-27', 'FUTURE'),
  ],
  expectedUnscheduled: [{ stepId: STEP_FRI_ID, date: '2026-11-19', reason: 'not_a_scheduled_date' }],
  expectedAmbiguous: [],
};

export const goalD: PipelineFixture = {
  category: 'application-realistic',
  producedBy:
    'POST /auth/goals/:id/steps from Goal Detail when the schedule text is exactly "weekly". The stored row has repeat "weekly" and repeatDay null. New writes reject that text. This legacy row is not rewritten, Today does not show it, and the snapshot keeps it ambiguous. The fixture data is unchanged.',
  goal: customGoal({
    id: GOAL_D_ID,
    title: 'Review Java Once a Week',
    description: 'A weekly step saved without a weekday.',
  }),
  steps: [
    step({
      id: STEP_AMBIGUOUS_ID,
      goalId: GOAL_D_ID,
      text: 'Review Java notes',
      order: 0,
      repeat: 'weekly',
    }),
  ],
  completions: [],
  expectedSummary: { done: 0, missed: 0, todo: 0, future: 0, total: 0 },
  expectedOccurrences: [],
  expectedUnscheduled: [],
  expectedAmbiguous: [{ stepId: STEP_AMBIGUOUS_ID, reason: 'weekly_missing_weekday' }],
};

export const goalE: PipelineFixture = {
  category: 'synthetic-edge',
  producedBy:
    'Not produced by Goal Detail or the AI planner save path. Both of those send either dueAt or repeat, never both. POST /auth/goals/:id/steps would still persist both fields because the handler copies dueAt and repeat independently. This row exists only to test that conflict.',
  goal: customGoal({
    id: GOAL_E_ID,
    title: 'Java Hour With a Conflicting Schedule',
    description: 'Synthetic row: a due date and a daily repeat on the same step.',
  }),
  steps: [
    step({
      id: STEP_CONFLICT_ID,
      goalId: GOAL_E_ID,
      text: 'Study Java for an hour',
      order: 0,
      dueAt: budapestEndOfDay('2026-11-24'),
      repeat: 'daily',
    }),
  ],
  completions: [],
  expectedSummary: { done: 0, missed: 0, todo: 0, future: 0, total: 0 },
  expectedOccurrences: [],
  expectedUnscheduled: [],
  expectedAmbiguous: [{ stepId: STEP_CONFLICT_ID, reason: 'conflicting_due_and_repeat' }],
};

export const pipelineFixtures: PipelineFixture[] = [goalA, goalB, goalC, goalD, goalE];

const LIMIT_60: RecoveryConstraints = { dailyWorkloadLimitMinutes: 60 };
const LIMIT_180: RecoveryConstraints = { dailyWorkloadLimitMinutes: 180 };

function timed(activityId: string, stepId: string, date: string, start: number, duration = 30): RecoveryPlan['activities'][number] {
  return { activityId, stepId, date, durationMinutes: duration, startMinuteOfDay: start };
}

function undated(activityId: string, stepId: string, date: string): RecoveryPlan['activities'][number] {
  return { activityId, stepId, date };
}

function preservedStudy(): RecoveryPlan['activities'] {
  return studyDone.map((date, index) => timed(`study-done-${index + 1}`, STEP_STUDY_ID, date, 1080));
}

export const pipelineScenarios: PipelineScenario[] = [
  {
    id: 'goal-a-valid-recovery',
    category: 'application-realistic',
    goalId: GOAL_A_ID,
    note: 'Keeps the three reported study days and moves the two missed days onto 22 and 23 Nov. Slots and the 60-minute limit are explicit.',
    expectedVerdict: 'PASS',
    expectedViolationCodes: [],
    expectedNotEvaluated: [],
    expectRecoversMissedWork: true,
    plan: {
      goalId: GOAL_A_ID,
      activities: [
        ...preservedStudy(),
        timed('study-recover-19', STEP_STUDY_ID, '2026-11-22', 480),
        timed('study-recover-20', STEP_STUDY_ID, '2026-11-23', 480),
      ],
    },
    constraints: LIMIT_60,
  },
  {
    id: 'goal-a-after-deadline',
    category: 'application-realistic',
    goalId: GOAL_A_ID,
    note: 'Same reported days, plus a study activity on 29 Nov, after the 28 Nov deadline.',
    expectedVerdict: 'FAIL',
    expectedViolationCodes: ['AFTER_DEADLINE'],
    expectedNotEvaluated: [],
    expectRecoversMissedWork: true,
    plan: {
      goalId: GOAL_A_ID,
      activities: [...preservedStudy(), timed('study-late', STEP_STUDY_ID, '2026-11-29', 480)],
    },
    constraints: LIMIT_60,
  },
  {
    id: 'goal-a-past-date',
    category: 'application-realistic',
    goalId: GOAL_A_ID,
    note: 'Tries to place new work on the missed day 20 Nov, which is before asOf and is not a DONE row.',
    expectedVerdict: 'FAIL',
    expectedViolationCodes: ['PAST_DATE'],
    expectedNotEvaluated: [],
    expectRecoversMissedWork: false,
    plan: {
      goalId: GOAL_A_ID,
      activities: [...preservedStudy(), timed('study-past', STEP_STUDY_ID, '2026-11-20', 480)],
    },
    constraints: LIMIT_60,
  },
  {
    id: 'goal-a-done-dropped',
    category: 'application-realistic',
    goalId: GOAL_A_ID,
    note: 'Edits the study step but omits the reported completions on 16, 17, and 18 Nov.',
    expectedVerdict: 'FAIL',
    expectedViolationCodes: ['DONE_DROPPED', 'DONE_DROPPED', 'DONE_DROPPED'],
    expectedNotEvaluated: [],
    expectRecoversMissedWork: true,
    plan: {
      goalId: GOAL_A_ID,
      activities: [timed('study-only-future', STEP_STUDY_ID, '2026-11-22', 480)],
    },
    constraints: LIMIT_60,
  },
  {
    id: 'goal-a-unknown-step',
    category: 'application-realistic',
    goalId: GOAL_A_ID,
    note: 'Names a step id that is not on the goal. The future activity is on that unknown step, so it does not cover the missed study days.',
    expectedVerdict: 'FAIL',
    expectedViolationCodes: ['UNKNOWN_STEP'],
    expectedNotEvaluated: [],
    expectRecoversMissedWork: false,
    plan: {
      goalId: GOAL_A_ID,
      activities: [
        ...preservedStudy(),
        timed('invented', '99999999-9999-4999-8999-999999999999', '2026-11-22', 480),
      ],
    },
    constraints: LIMIT_60,
  },
  {
    id: 'goal-a-duplicate-activity',
    category: 'application-realistic',
    goalId: GOAL_A_ID,
    note: 'Uses the activity id study-done-1 twice. The reported days themselves stay in the plan. The rejected copy is dated 22 Nov, which would have covered a missed study day.',
    expectedVerdict: 'FAIL',
    expectedViolationCodes: ['DUPLICATE_ACTIVITY'],
    expectedNotEvaluated: [],
    expectRecoversMissedWork: true,
    plan: {
      goalId: GOAL_A_ID,
      activities: [
        ...preservedStudy(),
        timed('study-done-1', STEP_STUDY_ID, '2026-11-22', 480),
      ],
    },
    constraints: LIMIT_60,
  },
  {
    id: 'goal-b-workload',
    category: 'application-realistic',
    goalId: GOAL_B_ID,
    note: '22 Nov holds 40 plus 40 minutes against an explicit 60-minute limit. The slots do not overlap.',
    expectedVerdict: 'FAIL',
    expectedViolationCodes: ['WORKLOAD_EXCEEDED'],
    expectedNotEvaluated: [],
    expectRecoversMissedWork: true,
    plan: {
      goalId: GOAL_B_ID,
      activities: [
        timed('diagram-done', STEP_DIAGRAM_ID, '2026-11-18', 600, 20),
        timed('implement-moved', STEP_IMPLEMENT_ID, '2026-11-22', 480, 40),
        timed('tests-moved', STEP_TESTS_ID, '2026-11-22', 1080, 40),
      ],
    },
    constraints: LIMIT_60,
  },
  {
    id: 'goal-b-time-conflict',
    category: 'application-realistic',
    goalId: GOAL_B_ID,
    note: '22 Nov starts one hour at 08:00 and another at 08:30. The daily limit is 180, so the overlap is the only violation.',
    expectedVerdict: 'FAIL',
    expectedViolationCodes: ['TIME_CONFLICT'],
    expectedNotEvaluated: [],
    expectRecoversMissedWork: true,
    plan: {
      goalId: GOAL_B_ID,
      activities: [
        timed('diagram-done', STEP_DIAGRAM_ID, '2026-11-18', 600, 20),
        timed('implement-moved', STEP_IMPLEMENT_ID, '2026-11-22', 480, 60),
        timed('tests-moved', STEP_TESTS_ID, '2026-11-22', 510, 60),
      ],
    },
    constraints: LIMIT_180,
  },
  {
    id: 'goal-a-missing-constraints',
    category: 'application-realistic',
    goalId: GOAL_A_ID,
    note: 'Dates are present, but no duration, start time, or daily limit is supplied. This must stay UNKNOWN.',
    expectedVerdict: 'UNKNOWN',
    expectedViolationCodes: [],
    expectedNotEvaluated: ['TIME_CONFLICT', 'WORKLOAD'],
    expectRecoversMissedWork: null,
    plan: {
      goalId: GOAL_A_ID,
      activities: [
        ...studyDone.map((date, index) => undated(`study-open-${index + 1}`, STEP_STUDY_ID, date)),
        undated('study-open-future', STEP_STUDY_ID, '2026-11-22'),
      ],
    },
    constraints: {},
  },
  {
    id: 'goal-d-ambiguous-schedule',
    category: 'application-realistic',
    goalId: GOAL_D_ID,
    note: 'The weekly step has no weekday. A fully timed activity still cannot be called feasible.',
    expectedVerdict: 'UNKNOWN',
    expectedViolationCodes: [],
    expectedNotEvaluated: ['SCHEDULE_KNOWN'],
    expectRecoversMissedWork: null,
    plan: {
      goalId: GOAL_D_ID,
      activities: [timed('notes-once', STEP_AMBIGUOUS_ID, '2026-11-23', 480)],
    },
    constraints: LIMIT_60,
  },
  {
    id: 'goal-a-constraints-without-recovery',
    category: 'application-realistic',
    goalId: GOAL_A_ID,
    note: 'Protects the reported days and adds nothing for 19 or 20 Nov. Constraint validity is not recovery usefulness. The verifier is expected to PASS.',
    expectedVerdict: 'PASS',
    expectedViolationCodes: [],
    expectedNotEvaluated: [],
    expectRecoversMissedWork: false,
    plan: {
      goalId: GOAL_A_ID,
      activities: preservedStudy(),
    },
    constraints: LIMIT_60,
  },
  {
    id: 'goal-c-off-schedule-completion',
    category: 'application-realistic',
    goalId: GOAL_C_ID,
    note: 'Recovers the missed Friday onto Monday 23 Nov. The Thursday 19 Nov completion is off the current Friday schedule, so it is not a DONE occurrence the plan must repeat.',
    expectedVerdict: 'PASS',
    expectedViolationCodes: [],
    expectedNotEvaluated: [],
    expectRecoversMissedWork: true,
    plan: {
      goalId: GOAL_C_ID,
      activities: [
        timed('mon-done', STEP_MON_ID, '2026-11-16', 480, 25),
        timed('wed-done', STEP_WED_ID, '2026-11-18', 480, 25),
        timed('fri-recovered', STEP_FRI_ID, '2026-11-23', 600, 25),
      ],
    },
    constraints: LIMIT_60,
  },
  {
    id: 'goal-e-synthetic-conflict',
    category: 'synthetic-edge',
    goalId: GOAL_E_ID,
    note: 'A due date and a daily repeat on one step. The schedule check cannot be completed.',
    expectedVerdict: 'UNKNOWN',
    expectedViolationCodes: [],
    expectedNotEvaluated: ['SCHEDULE_KNOWN'],
    expectRecoversMissedWork: null,
    plan: {
      goalId: GOAL_E_ID,
      activities: [timed('conflict-hour', STEP_CONFLICT_ID, '2026-11-23', 480, 60)],
    },
    constraints: LIMIT_60,
  },
];
