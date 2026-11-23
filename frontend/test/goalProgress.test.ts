import assert from 'node:assert/strict';
import test from 'node:test';

import { goalProgressLabel } from '../src/utils/goalProgress.ts';

test('Home and Goals List use one progress label', () => {
  const goal = { dueAt: '2026-11-30T00:00:00.000Z', progressPct: 27.27 };
  assert.equal(goalProgressLabel(goal), 'Progress: 27.27%');
  assert.equal(goalProgressLabel(goal), goalProgressLabel({ ...goal }));
  assert.equal(goalProgressLabel({ dueAt: null, progressPct: 10 }), 'No deadline');
  assert.equal(goalProgressLabel({ dueAt: null, progressPct: 0 }), 'No deadline');
});
