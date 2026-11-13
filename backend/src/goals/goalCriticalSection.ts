import { denialForFail, denialForGoalEdit, type GoalLifecycleState } from './lifecycle.js';

export class GoalLifecycleError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function withLockedGoal<T>(
  load: () => Promise<(GoalLifecycleState & { deletedAt?: Date | string | null }) | null>,
  run: () => Promise<T>,
  mode: 'edit' | 'fail' = 'edit'
): Promise<T> {
  const goal = await load();
  if (!goal) throw new GoalLifecycleError(404, 'Not found');
  const denial = mode === 'fail' ? denialForFail(goal) : denialForGoalEdit(goal);
  if (denial) throw new GoalLifecycleError(denial.status, denial.error);
  return run();
}
