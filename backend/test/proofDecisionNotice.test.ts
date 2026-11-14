import assert from 'node:assert/strict';
import test from 'node:test';

import { proofDecisionNotice } from '../src/goals/proofDecisionNotice.ts';

test('proof notifications name the reviewer and include a rejection reason', () => {
  const approved = proofDecisionNotice({ goalTitle: 'Run 5k', status: 'APPROVED', reviewer: 'AI' });
  assert.equal(approved.body, 'Run 5k was approved by AI.');

  const rejected = proofDecisionNotice({
    goalTitle: 'Run 5k',
    status: 'REJECTED',
    reviewer: 'admin',
    reason: 'The video does not show the finish line.',
  });
  assert.equal(rejected.title, 'Proof rejected');
  assert.equal(rejected.body, 'Run 5k was rejected by an admin. Reason: The video does not show the finish line.');
  assert.equal(rejected.reviewer, 'admin');

  const missing = proofDecisionNotice({ goalTitle: 'Run 5k', status: 'REJECTED', reviewer: 'AI', reason: '  ' });
  assert.equal(missing.body, 'Run 5k was rejected by AI. No reason was provided.');
  assert.equal(missing.reason, null);
});
