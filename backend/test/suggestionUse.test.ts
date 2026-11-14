import assert from 'node:assert/strict';
import test from 'node:test';

import { claimSuggestionOnce, SuggestionAlreadyUsed } from '../src/goals/suggestionToken.ts';

function uniqueStore() {
  const used = new Set<string>();
  let pending = Promise.resolve();
  return {
    used,
    create(jti: string) {
      const job = pending.then(() => {
        if (used.has(jti)) {
          const error = new Error('unique') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        used.add(jti);
      });
      pending = job.then(
        () => undefined,
        () => undefined
      );
      return job;
    },
  };
}

test('the same suggestion token cannot be claimed twice', async () => {
  const store = uniqueStore();
  await claimSuggestionOnce(jti => store.create(jti), 'jti-1', 'user-1');
  await assert.rejects(() => claimSuggestionOnce(jti => store.create(jti), 'jti-1', 'user-1'), SuggestionAlreadyUsed);
  assert.equal(store.used.size, 1);
});

test('concurrent claims accept one suggestion token', async () => {
  const store = uniqueStore();
  const results = await Promise.allSettled([
    claimSuggestionOnce(jti => store.create(jti), 'jti-2', 'user-1'),
    claimSuggestionOnce(jti => store.create(jti), 'jti-2', 'user-1'),
  ]);
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].status === 'rejected' && rejected[0].reason instanceof SuggestionAlreadyUsed, true);
  assert.equal(store.used.size, 1);
});
