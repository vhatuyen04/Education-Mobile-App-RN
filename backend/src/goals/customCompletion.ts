import { AntiFarmStale, antiFarmFingerprint, type AntiFarmGoal, type AntiFarmRecent, type RewardAmounts } from './antiFarm.js';
import { userCompletionDecision } from './lifecycle.js';
import { scoreFieldForRank, type LockedUserStreak } from './proofApproval.js';
import { nextGoalStreak } from './streak.js';

export type CustomGoalRow = AntiFarmGoal & {
  userId: string;
  completed: boolean;
  failedAt: Date | null;
};

export type CustomCompletionPatch = {
  title?: string;
  description?: string | null;
  requirement?: string | null;
  requirementSource?: 'USER' | 'AI';
  rankField?: 'Sport' | 'Academy' | 'Entertainment' | null;
  progressPct?: number;
  dueAt?: Date | null;
};

export type CustomCompletionDb = {
  lockUser(userId: string): Promise<LockedUserStreak | null>;
  lockGoal(goalId: string, userId: string): Promise<CustomGoalRow | null>;
  listRecent(userId: string, goal: { id: string; rankField: string | null }): Promise<AntiFarmRecent[]>;
  updateGoal(goalId: string, userId: string, data: CustomCompletionPatch & { completed: true }): Promise<number>;
  addUserRewards(userId: string, delta: { xp: number; points: number; scoreField: 'sportScore' | 'academyScore' | 'entertainmentScore' | null }): Promise<void>;
  saveStreak(userId: string, streak: { goalStreakDays: number; lastGoalCompletedAt: Date }): Promise<void>;
};

export type CustomCompletionResult =
  | { ok: true; awardedPoints: number; awardedXp: number; rankField: 'Sport' | 'Academy' | 'Entertainment' | null }
  | { ok: false; status: number; error: string };

export function rewardSubject(goal: CustomGoalRow | AntiFarmGoal, patch: CustomCompletionPatch): AntiFarmGoal {
  return {
    id: goal.id,
    title: patch.title !== undefined ? patch.title : goal.title,
    description: patch.description !== undefined ? patch.description : goal.description,
    rankField: patch.rankField !== undefined ? patch.rankField : goal.rankField,
    requirementSource: patch.requirementSource !== undefined ? patch.requirementSource : goal.requirementSource,
    difficultyScore: goal.difficultyScore,
    pointsAwarded: goal.pointsAwarded,
    xpAwarded: goal.xpAwarded,
  };
}

function asRank(field: string | null | undefined): 'Sport' | 'Academy' | 'Entertainment' | null {
  if (field === 'Sport' || field === 'Academy' || field === 'Entertainment') return field;
  return null;
}

export async function applyCustomCompletion(
  db: CustomCompletionDb,
  params: {
    userId: string;
    goalId: string;
    patch: CustomCompletionPatch;
    rewards: RewardAmounts;
    fingerprint: string | null;
    now?: Date;
  }
): Promise<CustomCompletionResult> {
  const now = params.now ?? new Date();
  const user = await db.lockUser(params.userId);
  if (!user) return { ok: false, status: 404, error: 'Not found' };
  const goal = await db.lockGoal(params.goalId, params.userId);
  if (!goal) return { ok: false, status: 404, error: 'Not found' };

  const decision = userCompletionDecision(goal, true);
  if (decision !== 'complete') {
    return typeof decision === 'string'
      ? { ok: false, status: 409, error: 'Goal can no longer be edited' }
      : { ok: false, status: decision.status, error: decision.error };
  }

  const subject = rewardSubject(goal, params.patch);
  const recent = await db.listRecent(params.userId, subject);
  if (params.fingerprint === null || antiFarmFingerprint(subject, recent) !== params.fingerprint) {
    throw new AntiFarmStale();
  }

  const claimed = await db.updateGoal(params.goalId, params.userId, { ...params.patch, completed: true });
  if (claimed !== 1) return { ok: false, status: 409, error: 'Goal can no longer be edited' };

  const awardedPoints = 0;
  const awardedXp = 0;
  await db.addUserRewards(user.id, {
    xp: awardedXp,
    points: awardedPoints,
    scoreField: scoreFieldForRank(subject.rankField),
  });
  await db.saveStreak(user.id, nextGoalStreak(user, now));
  return { ok: true, awardedPoints, awardedXp, rankField: asRank(subject.rankField) };
}
