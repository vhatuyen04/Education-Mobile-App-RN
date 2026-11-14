import assert from 'node:assert/strict';
import test from 'node:test';

import { approvedGoalRewardMessage, customGoalCompletionMessage } from './completionMessage.ts';

test('custom goal completion does not claim a reward', () => {
  assert.equal(customGoalCompletionMessage(), 'Goal completed');
});

test('approved goals show persisted rewards, including zero, and omit missing awards', () => {
  assert.equal(approvedGoalRewardMessage({ awardedXp: 8, awardedPoints: 1 }), 'SmartGoal: Goal completed. +8 XP. +1 point.');
  assert.equal(approvedGoalRewardMessage({ awardedXp: 0, awardedPoints: 0 }), 'SmartGoal: Goal completed. +0 XP. +0 points.');
  assert.equal(approvedGoalRewardMessage({ awardedXp: null, awardedPoints: null }), 'SmartGoal: Goal completed.');
  assert.equal(approvedGoalRewardMessage({}), 'SmartGoal: Goal completed.');
});
