export type GoalLifecycleState = {
  completed: boolean;
  failedAt: Date | string | null;
};

export type LifecycleError = { status: 409; error: string };

const IMMUTABLE = { status: 409 as const, error: 'Goal can no longer be edited' };
const PROOF_REQUIRED = { status: 409 as const, error: 'Goal completion requires proof review' };

export function isTerminalGoal(goal: GoalLifecycleState): boolean {
  return goal.completed === true || goal.failedAt != null;
}

export function activeGoalFilter(id: string, userId: string) {
  return { id, userId, completed: false as const, failedAt: null };
}

export function denialForGoalEdit(goal: GoalLifecycleState): LifecycleError | null {
  if (!isTerminalGoal(goal)) return null;
  return IMMUTABLE;
}

export function denialForFail(goal: GoalLifecycleState & { deletedAt?: Date | string | null }): { status: 400 | 409; error: string } | null {
  if (goal.deletedAt != null) return { status: 400, error: 'Goal deleted' };
  if (isTerminalGoal(goal)) return IMMUTABLE;
  return null;
}

export function goalRequiresProofReview(goal: { requirementSource: string | null; difficultyScore: number | null }): boolean {
  return goal.requirementSource === 'AI' || goal.difficultyScore != null;
}

export function userCompletionDecision(
  goal: GoalLifecycleState & { requirementSource: string | null; difficultyScore: number | null },
  requestedCompleted: boolean | undefined
): 'ignore' | 'complete' | LifecycleError {
  if (requestedCompleted === undefined) return 'ignore';
  if (requestedCompleted === false || isTerminalGoal(goal)) return IMMUTABLE;
  if (goalRequiresProofReview(goal)) return PROOF_REQUIRED;
  return 'complete';
}

export function proofStatusForDecision(decision: 'APPROVE' | 'REJECT'): 'APPROVED' | 'REJECTED' {
  return decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
}

export function approvalShouldComplete(decision: 'APPROVE' | 'REJECT', goal: GoalLifecycleState): boolean {
  return decision === 'APPROVE' && !isTerminalGoal(goal);
}

export function proofResubmitDecision(goal: GoalLifecycleState): { ok: true } | { ok: false; error: LifecycleError } {
  const denial = denialForGoalEdit(goal);
  if (denial) return { ok: false, error: denial };
  return { ok: true };
}
