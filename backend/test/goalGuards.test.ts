import assert from 'node:assert/strict';
import test from 'node:test';

import { GoalLifecycleError, withLockedGoal } from '../src/goals/goalCriticalSection.ts';
import { mockReviewAccess } from '../src/goals/mockReviewAccess.ts';

test('production rejects mock review even for an opted-in admin', () => {
  const decision = mockReviewAccess({ nodeEnv: 'production', allowMockReview: 'true', isAdmin: true });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 403);
});

test('local mock review requires both the opt-in and an admin', () => {
  assert.equal(mockReviewAccess({ nodeEnv: 'development', allowMockReview: undefined, isAdmin: true }).ok, false);
  assert.equal(mockReviewAccess({ nodeEnv: 'development', allowMockReview: 'true', isAdmin: false }).ok, false);
  assert.equal(mockReviewAccess({ nodeEnv: undefined, allowMockReview: '1', isAdmin: true }).ok, true);
});

function createRowLock() {
  let tail = Promise.resolve();
  return async function exclusive<T>(run: () => Promise<T>): Promise<T> {
    const previous = tail;
    let release: () => void = () => {};
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await run();
    } finally {
      release();
    }
  };
}

test('a step write waits while completion holds the goal lock, then sees the terminal goal', async () => {
  const state = { completed: false, failedAt: null as Date | null, steps: [] as string[] };
  const exclusive = createRowLock();
  let releaseHold: () => void = () => {};
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  let completionEntered = false;

  const completion = exclusive(() =>
    withLockedGoal(
      async () => ({ completed: state.completed, failedAt: state.failedAt }),
      async () => {
        completionEntered = true;
        await hold;
        state.completed = true;
      }
    )
  );
  while (!completionEntered) await new Promise((resolve) => setTimeout(resolve, 1));

  const stepWrite = exclusive(() =>
    withLockedGoal(
      async () => ({ completed: state.completed, failedAt: state.failedAt }),
      async () => {
        state.steps.push('late');
      }
    )
  );
  releaseHold();
  await completion;
  await assert.rejects(stepWrite, (error: unknown) => error instanceof GoalLifecycleError && error.status === 409);
  assert.deepEqual(state.steps, []);
  assert.equal(state.completed, true);
});

test('completion waits for an in-flight step write, and an active goal can still change a step', async () => {
  const state = { completed: false, failedAt: null as Date | null, steps: [] as string[] };
  const exclusive = createRowLock();
  let releaseHold: () => void = () => {};
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  let stepEntered = false;

  const stepWrite = exclusive(() =>
    withLockedGoal(
      async () => ({ completed: state.completed, failedAt: state.failedAt }),
      async () => {
        stepEntered = true;
        await hold;
        state.steps.push('first');
      }
    )
  );
  while (!stepEntered) await new Promise((resolve) => setTimeout(resolve, 1));

  const completion = exclusive(() =>
    withLockedGoal(
      async () => ({ completed: state.completed, failedAt: state.failedAt }),
      async () => {
        state.completed = true;
      }
    )
  );
  releaseHold();
  await stepWrite;
  await completion;
  assert.deepEqual(state.steps, ['first']);
  assert.equal(state.completed, true);

  const active = { completed: false, failedAt: null as Date | null, steps: [] as string[] };
  await withLockedGoal(
    async () => ({ completed: active.completed, failedAt: active.failedAt }),
    async () => {
      active.steps.push('ok');
    }
  );
  assert.deepEqual(active.steps, ['ok']);
});
