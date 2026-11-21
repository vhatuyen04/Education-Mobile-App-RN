import { proofStatusForDecision } from './lifecycle.js';

export type RankFieldName = 'Sport' | 'Academy' | 'Entertainment';
export type ScoreFieldName = 'sportScore' | 'academyScore' | 'entertainmentScore';

export type LockedProofAttempt = {
  id: string;
  userId: string;
  goalId: string;
  status: 'PENDING_UPLOAD' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION';
  awardedPoints: number;
  awardedXp: number;
  challengeHash: string | null;
  moderationStatus: 'CLEAR' | 'FLAGGED' | 'UNCERTAIN' | null;
};

export type LockedGoalReward = {
  id: string;
  userId: string;
  completed: boolean;
  failedAt: Date | null;
  rankField: RankFieldName | null;
  title: string;
  description: string | null;
  requirementSource: 'USER' | 'AI' | null;
  difficultyScore: number | null;
  pointsAwarded: number | null;
  xpAwarded: number | null;
  rankingEligible: boolean | null;
};

export type LockedUserStreak = {
  id: string;
  name: string;
  goalStreakDays: number;
  lastGoalCompletedAt: Date | null;
};

export type ProofApprovalDb = {
  lockAttempt(attemptId: string): Promise<LockedProofAttempt | null>;
  lockGoal(goalId: string, userId: string): Promise<LockedGoalReward | null>;
  lockUser(userId: string): Promise<LockedUserStreak | null>;
  updateAttempt(
    attemptId: string,
    data: {
      status: 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION';
      aiFeedback: string | null;
      reviewedBy: 'admin' | 'AI';
      awardedPoints: number;
      awardedXp: number;
    }
  ): Promise<number>;
  markGoalCompleted(goalId: string, userId: string): Promise<number>;
  rankingAlreadySettled(goalId: string, exceptAttemptId: string): Promise<boolean>;
  addUserRewards(userId: string, delta: { xp: number; points: number; scoreField: ScoreFieldName | null }): Promise<void>;
  saveStreak(userId: string, streak: { goalStreakDays: number; lastGoalCompletedAt: Date }): Promise<void>;
};

export type ProofDecisionInput = {
  attemptId: string;
  decision: 'APPROVE' | 'REJECT';
  feedback: string | null;
  reviewer: 'admin' | 'AI';
  userId?: string;
  goalId?: string;
  challengeCode?: string | null;
  usernameConfirmed?: boolean;
  achievementConfirmed?: boolean;
  claimedUsername?: string | null;
};

export type ProofDecisionResult =
  | {
      ok: true;
      status: 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION';
      awardedPoints: number;
      awardedXp: number;
      userId: string;
      goalId: string;
      rankField: RankFieldName | null;
      completedGoal: boolean;
    }
  | { ok: false; error: string };

export function scoreFieldForRank(field: string | null | undefined): ScoreFieldName | null {
  if (field === 'Sport') return 'sportScore';
  if (field === 'Entertainment') return 'entertainmentScore';
  if (field === 'Academy') return 'academyScore';
  return null;
}

export class ProofDecisionConflict extends Error {
  result: ProofDecisionResult;

  constructor(result: ProofDecisionResult) {
    super(result.ok ? 'Proof decision conflict' : result.error);
    this.result = result;
  }
}

function whole(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export async function applyProofDecision(
  db: ProofApprovalDb,
  input: ProofDecisionInput,
  rewardsFor: (goal: LockedGoalReward) => Promise<{ points: number; xp: number }>,
  _now = new Date()
): Promise<ProofDecisionResult> {
  const attempt = await db.lockAttempt(input.attemptId);
  if (!attempt) return { ok: false, error: 'Not found' };
  if (input.userId && attempt.userId !== input.userId) return { ok: false, error: 'Not found' };
  if (input.goalId && attempt.goalId !== input.goalId) return { ok: false, error: 'Not found' };
  if (attempt.status !== 'PENDING_REVIEW') return { ok: false, error: 'Attempt is not pending review' };

  const nextStatus = proofStatusForDecision(input.decision);
  if (input.decision === 'REJECT') {
    const updated = await db.updateAttempt(attempt.id, {
      status: 'REJECTED',
      aiFeedback: input.feedback,
      reviewedBy: input.reviewer,
      awardedPoints: 0,
      awardedXp: 0,
    });
    if (updated !== 1) throw new ProofDecisionConflict({ ok: false, error: 'Attempt is not pending review' });
    return {
      ok: true,
      status: 'REJECTED',
      awardedPoints: 0,
      awardedXp: 0,
      userId: attempt.userId,
      goalId: attempt.goalId,
      rankField: null,
      completedGoal: false,
    };
  }

  const user = await db.lockUser(attempt.userId);
  if (!user) return { ok: false, error: 'Not found' };
  const goal = await db.lockGoal(attempt.goalId, attempt.userId);
  if (!goal) return { ok: false, error: 'Not found' };

  if (!goal.completed || goal.failedAt || goal.requirementSource !== 'AI' || goal.rankingEligible !== true) {
    return { ok: false, error: 'Goal is not eligible for ranking' };
  }
  if (input.reviewer !== 'admin') return { ok: false, error: 'Only an admin can approve ranking proof' };
  if (attempt.moderationStatus === 'FLAGGED') return { ok: false, error: 'Content moderation flagged this proof' };
  if (!user.name.trim()) return { ok: false, error: 'Account has no username to confirm' };

  const rewards = await rewardsFor(goal);
  const alreadySettled = await db.rankingAlreadySettled(goal.id, attempt.id);
  const awardedPoints = alreadySettled ? 0 : whole(rewards.points);
  const awardedXp = 0;
  if (awardedPoints > 0) {
    await db.addUserRewards(user.id, {
      xp: 0,
      points: awardedPoints,
      scoreField: scoreFieldForRank(goal.rankField),
    });
  }

  const updated = await db.updateAttempt(attempt.id, {
    status: nextStatus,
    aiFeedback: input.feedback,
    reviewedBy: input.reviewer,
    awardedPoints,
    awardedXp,
  });
  if (updated !== 1) throw new ProofDecisionConflict({ ok: false, error: 'Attempt is not pending review' });

  return {
    ok: true,
    status: 'APPROVED',
    awardedPoints,
    awardedXp,
    userId: attempt.userId,
    goalId: attempt.goalId,
    rankField: goal.rankField,
    completedGoal: false,
  };
}
