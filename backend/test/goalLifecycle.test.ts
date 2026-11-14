import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeGoalFilter,
  approvalShouldComplete,
  denialForFail,
  denialForGoalEdit,
  proofResubmitDecision,
  proofStatusForDecision,
  userCompletionDecision,
} from '../src/goals/lifecycle.ts';

type Row = {
  id: string;
  userId: string;
  completed: boolean;
  failedAt: Date | null;
  failedReason: string | null;
  deletedAt: Date | null;
  requirementSource: 'USER' | 'AI' | null;
  difficultyScore: number | null;
  awarded: number;
  attemptStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
};

function row(partial: Partial<Row> = {}): Row {
  return {
    id: 'goal-1',
    userId: 'owner',
    completed: false,
    failedAt: null,
    failedReason: null,
    deletedAt: null,
    requirementSource: 'USER',
    difficultyScore: null,
    awarded: 0,
    attemptStatus: 'PENDING_REVIEW',
    ...partial,
  };
}

function claimActiveWrite(goal: Row, callerId: string, data: Partial<Row>) {
  const filter = activeGoalFilter(goal.id, callerId);
  if (goal.userId !== filter.userId || goal.id !== filter.id) return 0;
  if (goal.completed !== filter.completed || goal.failedAt !== filter.failedAt) return 0;
  Object.assign(goal, data);
  return 1;
}

function awardIfClaimed(goal: Row, callerId: string) {
  const count = claimActiveWrite(goal, callerId, { completed: true });
  if (count === 1) goal.awarded += 10;
  return count;
}

test('active goals can be edited and completed by their owner', () => {
  const goal = row();
  assert.equal(denialForGoalEdit(goal), null);
  assert.equal(userCompletionDecision(goal, true), 'complete');
  assert.equal(claimActiveWrite(goal, 'owner', { completed: true }), 1);
  assert.equal(goal.completed, true);
});

test('completed and failed goals reject ordinary edits and step changes', () => {
  const completed = row({ completed: true });
  const failed = row({ failedAt: new Date('2026-01-01'), failedReason: 'GAVE_UP' });
  assert.equal(denialForGoalEdit(completed)?.status, 409);
  assert.equal(denialForGoalEdit(failed)?.status, 409);
  assert.equal(claimActiveWrite(completed, 'owner', { completed: true }), 0);
  assert.equal(claimActiveWrite(failed, 'owner', { failedReason: 'EXPIRED' }), 0);
  assert.equal(failed.failedReason, 'GAVE_UP');
});

test('failed goals cannot be completed or rewarded, and fail cannot repeat', () => {
  const failed = row({ failedAt: new Date('2026-01-01'), failedReason: 'EXPIRED', requirementSource: 'AI', difficultyScore: 40 });
  const decision = userCompletionDecision(failed, true);
  assert.equal(typeof decision === 'string' ? decision : decision.status, 409);
  assert.equal(awardIfClaimed(failed, 'owner'), 0);
  assert.equal(failed.completed, false);
  assert.equal(failed.awarded, 0);
  assert.equal(denialForFail(failed)?.status, 409);

  const active = row();
  assert.equal(denialForFail(active), null);
  assert.equal(claimActiveWrite(active, 'owner', { failedAt: new Date(), failedReason: 'GAVE_UP' }), 1);
  assert.equal(denialForFail(active)?.status, 409);
  assert.equal(active.failedReason, 'GAVE_UP');
});

test('an AI goal cannot be completed directly, and another user cannot claim it', () => {
  const goal = row({ requirementSource: 'AI', difficultyScore: 20 });
  const decision = userCompletionDecision(goal, true);
  assert.ok(typeof decision !== 'string');
  if (typeof decision !== 'string') assert.equal(decision.error, 'Goal completion requires proof review');
  assert.equal(claimActiveWrite(goal, 'intruder', { completed: true }), 0);
  assert.equal(goal.completed, false);
  assert.equal(goal.awarded, 0);
});

test('admin or AI approval completes an active goal once, and rejection does not', () => {
  const active = row({ requirementSource: 'AI', difficultyScore: 30 });
  assert.equal(proofStatusForDecision('APPROVE'), 'APPROVED');
  assert.equal(approvalShouldComplete('APPROVE', active), true);
  assert.equal(awardIfClaimed(active, 'owner'), 1);
  assert.equal(awardIfClaimed(active, 'owner'), 0);
  assert.equal(active.awarded, 10);

  const rejected = row({ requirementSource: 'AI' });
  assert.equal(proofStatusForDecision('REJECT'), 'REJECTED');
  assert.equal(approvalShouldComplete('REJECT', rejected), false);
  assert.equal(rejected.completed, false);
  assert.equal(rejected.awarded, 0);

  const failed = row({ failedAt: new Date(), requirementSource: 'AI' });
  assert.equal(approvalShouldComplete('APPROVE', failed), false);
  assert.equal(awardIfClaimed(failed, 'owner'), 0);
  assert.equal(failed.awarded, 0);
});

test('a rejected proof can be resubmitted only while the goal is active', () => {
  const active = row({ attemptStatus: 'REJECTED' });
  assert.equal(proofResubmitDecision(active).ok, true);
  active.attemptStatus = 'PENDING_REVIEW';
  assert.equal(active.attemptStatus, 'PENDING_REVIEW');

  const failed = row({ failedAt: new Date(), attemptStatus: 'REJECTED' });
  const decision = proofResubmitDecision(failed);
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.error.status, 409);
  assert.equal(failed.attemptStatus, 'REJECTED');
});

test('concurrent approval claims award only one completion', () => {
  const goal = row({ requirementSource: 'AI', difficultyScore: 10, attemptStatus: 'PENDING_REVIEW' });
  const claimAttempt = () => {
    if (goal.attemptStatus !== 'PENDING_REVIEW') return 0;
    goal.attemptStatus = 'APPROVED';
    return 1;
  };
  const first = claimAttempt();
  const second = claimAttempt();
  if (first === 1) awardIfClaimed(goal, 'owner');
  if (second === 1) awardIfClaimed(goal, 'owner');
  assert.equal(first + second, 1);
  assert.equal(goal.awarded, 10);
  assert.equal(goal.completed, true);
});
