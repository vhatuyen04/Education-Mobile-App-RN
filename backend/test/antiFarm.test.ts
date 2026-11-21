import assert from 'node:assert/strict';
import test from 'node:test';

import { heuristicFarm, rewardsForSnapshot, type AntiFarmGoal, type AntiFarmRecent } from '../src/goals/antiFarm.ts';

function goal(title: string, difficultyScore: number): AntiFarmGoal {
  return {
    id: 'new',
    title,
    description: null,
    rankField: 'Sport',
    requirementSource: 'AI',
    difficultyScore,
    pointsAwarded: 80,
    xpAwarded: 80,
  };
}

function recent(title: string, difficultyScore: number): AntiFarmRecent {
  return { id: title, title, description: null, difficultyScore };
}

test('the AI farm decision is kept even when the title number is higher', () => {
  const next = goal('Achieve 100 push-ups in a row', 70);
  const previous = [recent('Achieve 51 push-ups in a row', 70)];
  assert.equal(heuristicFarm(next, previous), false);
  assert.deepEqual(rewardsForSnapshot(next, previous, true, 'model'), { points: 0, xp: 0 });
  assert.deepEqual(rewardsForSnapshot(next, previous, false, 'model'), { points: 80, xp: 80 });
});

test('the same or lower repeat count can still be farming', () => {
  const next = goal('Achieve 51 push-ups in a row', 70);
  const previous = [recent('Achieve 51 push-ups in a row', 70)];
  assert.equal(heuristicFarm(next, previous), true);
  assert.deepEqual(rewardsForSnapshot(next, previous, true, 'heuristic'), { points: 0, xp: 0 });
});
