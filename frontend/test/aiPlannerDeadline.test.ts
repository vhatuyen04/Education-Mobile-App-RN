import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePlannerDeadline } from '../src/components/aiPlannerDeadline.ts';

test('deadline field validates calendar input independently of goal language', () => {
  const now = new Date(2026, 10, 24, 12);
  for (const input of ['2026-12-20', '12/20/2026']) {
    const result = resolvePlannerDeadline(input, now);
    assert.ok(result.kind === 'resolved');
    assert.equal(result.civil, '2026-12-20');
  }
  assert.equal(resolvePlannerDeadline('', now).kind, 'missing');
  assert.equal(resolvePlannerDeadline('2026-02-30', now).kind, 'invalid');
  assert.equal(resolvePlannerDeadline('2026-11-23', now).kind, 'past');
});
