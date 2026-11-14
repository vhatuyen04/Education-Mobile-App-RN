import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';

import { classifyCreatedGoal, rewardsForDifficultyScore } from '../src/goals/classifyGoal.ts';
import { userCompletionDecision } from '../src/goals/lifecycle.ts';
import { acceptAiSuggestion, AI_SUGGESTION_PURPOSE, signAiSuggestion, type TrustedAiSuggestion } from '../src/goals/suggestionToken.ts';

const secret = 'test-suggestion-secret';

function trusted(partial: Partial<TrustedAiSuggestion> = {}): TrustedAiSuggestion {
  return {
    difficultyScore: 40,
    difficultyConfidence: 0.7,
    difficultyReason: 'Steady practice',
    pointsAwarded: rewardsForDifficultyScore(40).pointsAwarded,
    xpAwarded: rewardsForDifficultyScore(40).xpAwarded,
    requirement: 'Practice daily',
    rankField: 'Academy',
    title: 'Practice piano',
    ...partial,
  };
}

function completionStatus(created: ReturnType<typeof classifyCreatedGoal>) {
  return userCompletionDecision(
    { completed: false, failedAt: null, requirementSource: created.requirementSource, difficultyScore: created.difficultyScore },
    true
  );
}

test('a signed AI suggestion is classified from the token, including an empty requirement', () => {
  const suggestion = trusted({ requirement: '', pointsAwarded: 0, xpAwarded: 0 });
  const token = signAiSuggestion('user-1', suggestion, secret);
  const accepted = acceptAiSuggestion(token, secret, 'user-1', suggestion);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const created = classifyCreatedGoal(accepted.suggestion);
  assert.equal(created.requirementSource, 'AI');
  assert.equal(created.requiresProof, true);
  assert.equal(created.pointsAwarded, 0);
  assert.equal(created.xpAwarded, 0);
  const decision = completionStatus(created);
  assert.equal(typeof decision === 'string' ? decision : decision.error, 'Goal completion requires proof review');
});

test('a forged difficulty score without a suggestion token stays a custom goal', () => {
  const created = classifyCreatedGoal(null);
  assert.equal(created.requirementSource, 'USER');
  assert.equal(created.difficultyScore, null);
  assert.equal(created.pointsAwarded, 0);
  assert.equal(created.xpAwarded, 0);
  assert.equal(completionStatus(created), 'complete');
});

test('suggestion tokens reject bad signatures, expiry, other users, modified rewards, and other purposes', () => {
  const suggestion = trusted();
  const token = signAiSuggestion('user-1', suggestion, secret);
  assert.equal(acceptAiSuggestion(`${token}x`, secret, 'user-1', suggestion).ok, false);
  assert.equal(acceptAiSuggestion(token, secret, 'user-2', suggestion).error, 'Suggestion does not match this user');
  assert.equal(acceptAiSuggestion(token, secret, 'user-1', { ...suggestion, pointsAwarded: 1000 }).error, 'Suggestion does not match the goal');
  assert.equal(acceptAiSuggestion(token, secret, 'user-1', { ...suggestion, difficultyScore: 100 }).error, 'Suggestion does not match the goal');
  assert.equal(acceptAiSuggestion(token, secret, 'user-1', { ...suggestion, title: 'Different title' }).error, 'Suggestion does not match the goal');
  assert.equal(acceptAiSuggestion(token, secret, 'user-1', suggestion).ok, true);

  const expired = jwt.sign({ purpose: AI_SUGGESTION_PURPOSE, sub: 'user-1', ...suggestion, exp: Math.floor(Date.now() / 1000) - 60 }, secret);
  assert.equal(acceptAiSuggestion(expired, secret, 'user-1', suggestion).error, 'Suggestion expired');

  const wrongPurpose = jwt.sign({ purpose: 'access', sub: 'user-1', ...suggestion }, secret, { expiresIn: '1h' });
  assert.equal(acceptAiSuggestion(wrongPurpose, secret, 'user-1', suggestion).error, 'Invalid suggestion');
});
