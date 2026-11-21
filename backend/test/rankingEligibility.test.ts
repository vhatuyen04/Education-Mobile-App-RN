import assert from 'node:assert/strict';
import test from 'node:test';

import { applyProofDecision, type ProofApprovalDb } from '../src/goals/proofApproval.ts';
import { challengeSubmissionDenial, createRankingChallenge, hashRankingChallenge, rankingProofDeadline, verifyRankingChallenge } from '../src/goals/rankingChallenge.ts';
import { rankingInvalidationPatch, rankingSubmissionDenial, resolveRankingEligibility } from '../src/goals/rankingEligibility.ts';
import { acceptAiSuggestion, signAiSuggestion } from '../src/goals/suggestionToken.ts';

const secret = 'ranking-secret';

test('ordinary and low-score goals stay ineligible, and a high measurable goal can qualify', () => {
  assert.equal(resolveRankingEligibility({ modelEligible: true, difficultyScore: 40, reason: 'Daily practice' }).rankingEligible, false);
  assert.equal(resolveRankingEligibility({ modelEligible: false, difficultyScore: 90, reason: 'Hard but routine' }).rankingEligible, false);
  assert.equal(resolveRankingEligibility({ modelEligible: true, difficultyScore: 85, reason: 'Recorded competition result' }).rankingEligible, true);
});

test('a client cannot raise ranking eligibility above the signed suggestion', () => {
  const token = signAiSuggestion('user-1', {
    title: 'Win the city final',
    deadline: '2026-12-01',
    difficultyScore: 85,
    difficultyConfidence: 0.8,
    difficultyReason: 'Competition',
    pointsAwarded: 90,
    xpAwarded: 90,
    requirement: 'Show the official result',
    rankField: 'Sport',
    rankingEligible: false,
    rankingEligibilityReason: 'Not unusual enough for ranking.',
  }, secret);
  const tampered = acceptAiSuggestion(token, secret, 'user-1', {
    title: 'Win the city final',
    difficultyScore: 85,
    difficultyConfidence: 0.8,
    difficultyReason: 'Competition',
    pointsAwarded: 90,
    xpAwarded: 90,
    requirement: 'Show the official result',
    rankField: 'Sport',
    rankingEligible: true,
  });
  assert.equal(tampered.ok, false);
});

test('editing a substantive requirement invalidates eligibility and drops the stored ranking score', () => {
  assert.deepEqual(rankingInvalidationPatch({
    requirementSource: 'AI',
    titleChanged: false,
    descriptionChanged: false,
    requirementChanged: true,
    rankFieldChanged: false,
  }), { rankingEligible: false, pointsAwarded: 0 });
  assert.equal(rankingInvalidationPatch({
    requirementSource: 'AI',
    titleChanged: false,
    descriptionChanged: false,
    requirementChanged: false,
    rankFieldChanged: false,
  }), null);
  assert.equal(rankingInvalidationPatch({
    requirementSource: 'USER',
    titleChanged: true,
    descriptionChanged: false,
    requirementChanged: false,
    rankFieldChanged: false,
  }), null);
});

test('ranking proof is refused for incomplete, custom, legacy, and already awarded goals', () => {
  const base = { completed: true, failedAt: null, requirementSource: 'AI' as const, rankingEligible: true, rankingSettled: false };
  assert.equal(rankingSubmissionDenial({ ...base, completed: false })?.error, 'Goal must be completed before ranking proof');
  assert.equal(rankingSubmissionDenial({ ...base, requirementSource: 'USER' })?.error, 'Goal is not eligible for ranking');
  assert.equal(rankingSubmissionDenial({ ...base, rankingEligible: null })?.error, 'Goal is not eligible for ranking');
  assert.equal(rankingSubmissionDenial({ ...base, rankingSettled: true })?.error, 'Ranking points were already awarded');
  assert.equal(rankingSubmissionDenial(base), null);
});

test('ranking proof closes three days after the goal is completed', () => {
  const completedAt = new Date('2026-11-17T00:00:00.000Z');
  assert.equal(rankingProofDeadline(completedAt).toISOString(), '2026-11-20T00:00:00.000Z');
});

test('a challenge expires before upload, cannot be reused, and still verifies after the upload window', () => {
  const now = new Date('2026-11-17T00:00:00.000Z');
  const expiresAt = rankingProofDeadline(now);
  const first = createRankingChallenge({ userId: 'user-1', goalId: 'goal-1', attemptId: 'attempt-1' }, expiresAt);
  const second = createRankingChallenge({ userId: 'user-1', goalId: 'goal-2', attemptId: 'attempt-2' }, expiresAt);
  assert.equal(verifyRankingChallenge(first.code, first.hash, { userId: 'user-1', goalId: 'goal-1', attemptId: 'attempt-1' }), true);
  assert.equal(verifyRankingChallenge(first.code, second.hash, { userId: 'user-1', goalId: 'goal-2', attemptId: 'attempt-2' }), false);
  assert.equal(verifyRankingChallenge('WRONG123', first.hash, { userId: 'user-1', goalId: 'goal-1', attemptId: 'attempt-1' }), false);
  assert.equal(challengeSubmissionDenial(first.expiresAt, new Date(first.expiresAt.getTime() + 1000))?.error, 'Challenge expired');
  assert.equal(challengeSubmissionDenial(first.expiresAt, new Date(first.expiresAt.getTime() - 1000)), null);
  assert.equal(verifyRankingChallenge(first.code, first.hash, { userId: 'user-1', goalId: 'goal-1', attemptId: 'attempt-1' }), true);
});

test('approval rejects an incomplete goal and pays a completed eligible goal once', async () => {
  const code = 'ZZ99ZZ99';
  const binding = { userId: 'user-1', goalId: 'goal-1', attemptId: 'attempt-1' };
  const state = {
    user: { id: 'user-1', name: 'ada', xp: 4, sportScore: 1, academyScore: 0, entertainmentScore: 0, goalStreakDays: 2, lastGoalCompletedAt: null },
    goal: {
      id: 'goal-1',
      userId: 'user-1',
      completed: false,
      failedAt: null,
      rankField: 'Sport' as const,
      title: 'Final',
      description: null,
      requirementSource: 'AI' as const,
      difficultyScore: 80,
      pointsAwarded: 6,
      xpAwarded: 6,
      rankingEligible: true as boolean | null,
    },
    attempt: {
      id: 'attempt-1',
      userId: 'user-1',
      goalId: 'goal-1',
      status: 'PENDING_REVIEW' as const,
      awardedPoints: 0,
      awardedXp: 0,
      challengeHash: hashRankingChallenge(code, binding),
      moderationStatus: 'CLEAR' as const,
    },
  };
  const db: ProofApprovalDb = {
    async lockAttempt() { return { ...state.attempt }; },
    async lockGoal() { return { ...state.goal }; },
    async lockUser() { return { ...state.user }; },
    async updateAttempt(_id, data) {
      if (state.attempt.status !== 'PENDING_REVIEW') return 0;
      Object.assign(state.attempt, data);
      return 1;
    },
    async markGoalCompleted() { return 0; },
    async rankingAlreadySettled() { return state.attempt.status === 'APPROVED'; },
    async addUserRewards(_id, delta) {
      if (delta.points > 0) state.user.sportScore += delta.points;
      if (delta.xp > 0) state.user.xp += delta.xp;
    },
    async saveStreak() { return undefined; },
  };
  const blocked = await applyProofDecision(db, { attemptId: 'attempt-1', decision: 'APPROVE', feedback: null, reviewer: 'admin', challengeCode: code }, async () => ({ points: 6, xp: 6 }));
  assert.equal(blocked.ok, false);
  assert.equal(state.user.sportScore, 1);
  state.goal.completed = true;
  const paid = await applyProofDecision(db, { attemptId: 'attempt-1', decision: 'APPROVE', feedback: null, reviewer: 'admin' }, async () => ({ points: 6, xp: 6 }));
  assert.equal(paid.ok, true);
  if (paid.ok) {
    assert.equal(paid.awardedPoints, 6);
    assert.equal(paid.awardedXp, 0);
    assert.equal(paid.completedGoal, false);
  }
  assert.equal(state.goal.completed, true);
  assert.equal(state.user.xp, 4);
  assert.equal(state.user.sportScore, 7);
  state.goal.rankingEligible = null;
  state.attempt.status = 'PENDING_REVIEW';
  const legacy = await applyProofDecision(db, { attemptId: 'attempt-1', decision: 'APPROVE', feedback: null, reviewer: 'admin', challengeCode: code }, async () => ({ points: 6, xp: 6 }));
  assert.equal(legacy.ok, false);
  assert.equal(state.user.sportScore, 7);
});
