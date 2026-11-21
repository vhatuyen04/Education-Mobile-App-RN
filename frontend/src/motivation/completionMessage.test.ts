import assert from 'node:assert/strict';
import test from 'node:test';

import { approvedGoalRewardMessage, customGoalCompletionMessage, goalSuccessMessage, rankingAwardMessage } from './completionMessage.ts';

test('custom goal completion does not claim a reward', () => {
  assert.equal(customGoalCompletionMessage(), 'Goal completed');
});

test('goal success names XP only when the server awarded it', () => {
  assert.equal(goalSuccessMessage(12), 'Goal completed. +12 XP.');
  assert.equal(goalSuccessMessage(0), 'Goal completed');
});

test('ranking approval reports ranking points and does not claim XP', () => {
  assert.equal(rankingAwardMessage(8), 'Ranking verified. +8 ranking points.');
  assert.equal(rankingAwardMessage(0), 'Ranking verified. No additional ranking points.');
});

test('approved goals show persisted rewards, including zero, and omit missing awards', () => {
  assert.equal(approvedGoalRewardMessage({ awardedXp: 8, awardedPoints: 1 }), 'SmartGoal: Goal completed. +8 XP. +1 point.');
  assert.equal(approvedGoalRewardMessage({ awardedXp: 0, awardedPoints: 0 }), 'SmartGoal: Goal completed. +0 XP. +0 points.');
  assert.equal(approvedGoalRewardMessage({ awardedXp: null, awardedPoints: null }), 'SmartGoal: Goal completed.');
  assert.equal(approvedGoalRewardMessage({}), 'SmartGoal: Goal completed.');
});
