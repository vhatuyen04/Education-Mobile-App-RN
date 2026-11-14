import assert from 'node:assert/strict';
import test from 'node:test';

import { antiFarmFingerprint, rewardsForSnapshot, settleApprovalRewards } from '../src/goals/antiFarm.ts';
import {
  applyCustomCompletion,
  type CustomCompletionDb,
  type CustomGoalRow,
} from '../src/goals/customCompletion.ts';
import type { LockedUserStreak } from '../src/goals/proofApproval.ts';

type UserRow = LockedUserStreak & { xp: number; sportScore: number; academyScore: number; entertainmentScore: number };
type State = { users: Record<string, UserRow>; goals: Record<string, CustomGoalRow> };

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  private owner: symbol | null = null;

  acquire(owner: symbol): Promise<() => void> {
    if (this.owner === owner) return Promise.resolve(() => {});
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const prev = this.tail;
    this.tail = gate;
    return prev.then(() => {
      this.owner = owner;
      return () => {
        if (this.owner === owner) this.owner = null;
        release();
      };
    });
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createDb(initial: State) {
  const state = clone(initial);
  const mutexes = new Map<string, Mutex>();
  const mutex = (key: string) => {
    let found = mutexes.get(key);
    if (!found) {
      found = new Mutex();
      mutexes.set(key, found);
    }
    return found;
  };

  async function transaction<T>(run: (db: CustomCompletionDb) => Promise<T>): Promise<T> {
    const txId = Symbol('tx');
    const releases: Array<() => void> = [];
    const writes: State = { users: {}, goals: {} };
    const dirty = { users: new Set<string>(), goals: new Set<string>() };

    async function hold<TRow>(key: string, read: () => TRow | undefined, slot: Record<string, TRow>, id: string) {
      releases.push(await mutex(key).acquire(txId));
      if (!slot[id]) {
        const current = read();
        if (!current) return null;
        slot[id] = clone(current);
      }
      return clone(slot[id]);
    }

    const db: CustomCompletionDb = {
      lockUser: userId => hold(`user:${userId}`, () => state.users[userId], writes.users, userId),
      lockGoal: (goalId, userId) =>
        hold(
          `goal:${goalId}`,
          () => {
            const goal = state.goals[goalId];
            if (!goal || goal.userId !== userId) return undefined;
            return goal;
          },
          writes.goals,
          goalId
        ),
      async listRecent(userId, goal) {
        if (!goal.rankField) return [];
        return Object.values(state.goals)
          .filter(item => item.userId === userId && item.completed && item.requirementSource === 'AI' && item.rankField === goal.rankField && item.id !== goal.id)
          .map(item => ({
            id: item.id,
            title: item.title,
            description: item.description,
            difficultyScore: item.difficultyScore,
          }));
      },
      async updateGoal(goalId, userId, data) {
        const goal = writes.goals[goalId];
        if (!goal || goal.userId !== userId || goal.completed || goal.failedAt) return 0;
        Object.assign(goal, data);
        dirty.goals.add(goalId);
        return 1;
      },
      async addUserRewards(userId, delta) {
        const user = writes.users[userId];
        if (!user) return;
        if (delta.xp > 0) user.xp += delta.xp;
        if (delta.points > 0 && delta.scoreField) user[delta.scoreField] += delta.points;
        if (delta.xp > 0 || (delta.points > 0 && delta.scoreField)) dirty.users.add(userId);
      },
      async saveStreak(userId, streak) {
        const user = writes.users[userId];
        if (!user) return;
        user.goalStreakDays = streak.goalStreakDays;
        user.lastGoalCompletedAt = streak.lastGoalCompletedAt;
        dirty.users.add(userId);
      },
    };

    try {
      const result = await run(db);
      for (const id of dirty.users) state.users[id] = writes.users[id];
      for (const id of dirty.goals) state.goals[id] = writes.goals[id];
      return result;
    } finally {
      for (const release of releases.reverse()) release();
    }
  }

  return { state, transaction };
}

function user(): UserRow {
  return {
    id: 'user-1',
    xp: 10,
    sportScore: 2,
    academyScore: 0,
    entertainmentScore: 0,
    goalStreakDays: 4,
    lastGoalCompletedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function goal(partial: Partial<CustomGoalRow> = {}): CustomGoalRow {
  return {
    id: 'goal-1',
    userId: 'user-1',
    title: 'Read',
    description: null,
    rankField: 'Academy',
    requirementSource: 'USER',
    difficultyScore: null,
    pointsAwarded: 0,
    xpAwarded: 0,
    completed: false,
    failedAt: null,
    ...partial,
  };
}

const day = new Date('2026-01-02T12:00:00.000Z');

test('a failed custom completion rolls back and a retry awards once', async () => {
  const db = createDb({ users: { 'user-1': user() }, goals: { 'goal-1': goal() } });
  await assert.rejects(() =>
    db.transaction(async tx => {
      const failing: CustomCompletionDb = {
        ...tx,
        updateGoal: async (goalId, userId, data) => {
          const count = await tx.updateGoal(goalId, userId, data);
          throw new Error(`write failed after claim ${count}`);
        },
      };
      return applyCustomCompletion(failing, {
        userId: 'user-1',
        goalId: 'goal-1',
        patch: {},
        rewards: { points: 1, xp: 0 },
        fingerprint: antiFarmFingerprint(goal(), []),
        now: day,
      });
    })
  );
  assert.equal(db.state.goals['goal-1'].completed, false);
  assert.equal(db.state.users['user-1'].xp, 10);
  assert.equal(db.state.users['user-1'].goalStreakDays, 4);

  const retried = await db.transaction(tx =>
    applyCustomCompletion(tx, {
      userId: 'user-1',
      goalId: 'goal-1',
      patch: {},
      rewards: { points: 1, xp: 0 },
      fingerprint: antiFarmFingerprint(goal(), []),
      now: day,
    })
  );
  assert.equal(retried.ok, true);
  if (retried.ok) assert.equal(retried.awardedPoints, 0);
  assert.equal(db.state.goals['goal-1'].completed, true);
  assert.equal(db.state.users['user-1'].academyScore, 0);
  assert.equal(db.state.users['user-1'].xp, 10);
  assert.equal(db.state.users['user-1'].goalStreakDays, 5);

  const again = await db.transaction(tx =>
    applyCustomCompletion(tx, {
      userId: 'user-1',
      goalId: 'goal-1',
      patch: {},
      rewards: { points: 1, xp: 0 },
      fingerprint: antiFarmFingerprint(goal(), []),
      now: day,
    })
  );
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.status, 409);
  assert.equal(db.state.users['user-1'].academyScore, 0);
  assert.equal(db.state.users['user-1'].goalStreakDays, 5);
});

test('concurrent custom completions award once', async () => {
  const db = createDb({ users: { 'user-1': user() }, goals: { 'goal-1': goal({ rankField: 'Sport', pointsAwarded: 6, xpAwarded: 6 }) } });
  const fingerprint = antiFarmFingerprint(goal({ rankField: 'Sport', pointsAwarded: 6, xpAwarded: 6 }), []);
  const once = () =>
    db.transaction(tx =>
      applyCustomCompletion(tx, {
        userId: 'user-1',
        goalId: 'goal-1',
        patch: {},
        rewards: { points: 6, xp: 6 },
        fingerprint,
        now: day,
      })
    );
  const [first, second] = await Promise.all([once(), once()]);
  const wins = [first, second].filter(result => result.ok);
  assert.equal(wins.length, 1);
  assert.equal(db.state.goals['goal-1'].completed, true);
  assert.equal(db.state.users['user-1'].xp, 10);
  assert.equal(db.state.users['user-1'].sportScore, 2);
});

test('a custom goal with a rank field receives no ranking points or XP', async () => {
  const stored = goal({ rankField: 'Sport', pointsAwarded: 0, xpAwarded: 0 });
  assert.deepEqual(rewardsForSnapshot(stored, [], null, 'heuristic'), { points: 0, xp: 0 });
  const db = createDb({ users: { 'user-1': user() }, goals: { 'goal-1': stored } });
  const decided = await db.transaction(tx =>
    applyCustomCompletion(tx, {
      userId: 'user-1',
      goalId: 'goal-1',
      patch: {},
      rewards: { points: 1, xp: 5 },
      fingerprint: antiFarmFingerprint(stored, []),
      now: day,
    })
  );
  assert.equal(decided.ok, true);
  if (decided.ok) {
    assert.equal(decided.awardedPoints, 0);
    assert.equal(decided.awardedXp, 0);
  }
  assert.equal(db.state.users['user-1'].sportScore, 2);
  assert.equal(db.state.users['user-1'].xp, 10);
  assert.equal(db.state.users['user-1'].goalStreakDays, 5);
});

test('a zero reward still completes the goal once', async () => {
  const stored = goal({ rankField: null, pointsAwarded: null, xpAwarded: null, requirementSource: 'USER', difficultyScore: null });
  const db = createDb({ users: { 'user-1': user() }, goals: { 'goal-1': stored } });
  const fingerprint = antiFarmFingerprint(stored, []);
  const decided = await db.transaction(tx =>
    applyCustomCompletion(tx, {
      userId: 'user-1',
      goalId: 'goal-1',
      patch: {},
      rewards: { points: 0, xp: 0 },
      fingerprint,
      now: day,
    })
  );
  assert.equal(decided.ok, true);
  if (decided.ok) {
    assert.equal(decided.awardedPoints, 0);
    assert.equal(decided.awardedXp, 0);
  }
  assert.equal(db.state.goals['goal-1'].completed, true);
  assert.equal(db.state.users['user-1'].xp, 10);
  assert.equal(db.state.users['user-1'].sportScore, 2);
  assert.equal(db.state.users['user-1'].goalStreakDays, 5);

  const retry = await db.transaction(tx =>
    applyCustomCompletion(tx, {
      userId: 'user-1',
      goalId: 'goal-1',
      patch: {},
      rewards: { points: 9, xp: 9 },
      fingerprint,
      now: day,
    })
  );
  assert.equal(retry.ok, false);
  assert.equal(db.state.users['user-1'].xp, 10);
});

test('an AI goal cannot be completed manually', async () => {
  const stored = goal({ requirementSource: 'AI', difficultyScore: 20, pointsAwarded: 4, xpAwarded: 4 });
  const db = createDb({ users: { 'user-1': user() }, goals: { 'goal-1': stored } });
  const decided = await db.transaction(tx =>
    applyCustomCompletion(tx, {
      userId: 'user-1',
      goalId: 'goal-1',
      patch: {},
      rewards: { points: 4, xp: 4 },
      fingerprint: antiFarmFingerprint(stored, []),
      now: day,
    })
  );
  assert.equal(decided.ok, false);
  if (!decided.ok) assert.equal(decided.error, 'Goal completion requires proof review');
  assert.equal(db.state.goals['goal-1'].completed, false);
  assert.equal(db.state.users['user-1'].xp, 10);
});

test('a stale anti-farm snapshot is retried outside the lock', async () => {
  const db = createDb({
    users: { 'user-1': user() },
    goals: {
      'goal-1': goal({ title: 'Run daily', rankField: 'Sport', pointsAwarded: 5, xpAwarded: 5 }),
      'goal-2': goal({ id: 'goal-2', title: 'Run daily', rankField: 'Sport', requirementSource: 'AI', pointsAwarded: 5, xpAwarded: 5 }),
    },
  });
  const decided = await settleApprovalRewards({
    maxAttempts: 3,
    load: async () => ({
      goal: clone(db.state.goals['goal-1']),
      recent: Object.values(db.state.goals)
        .filter(item => item.completed && item.id !== 'goal-1' && item.requirementSource === 'AI' && item.rankField === 'Sport')
        .map(item => ({ id: item.id, title: item.title, description: item.description, difficultyScore: item.difficultyScore })),
    }),
    decide: async (_goal, recent) => (recent.length ? { points: 0, xp: 0 } : { points: 5, xp: 5 }),
    commit: (rewards, fingerprint) => {
      db.state.goals['goal-2'].completed = true;
      return db.transaction(tx =>
        applyCustomCompletion(tx, {
          userId: 'user-1',
          goalId: 'goal-1',
          patch: {},
          rewards,
          fingerprint,
          now: day,
        })
      );
    },
  });
  assert.equal(decided.ok, true);
  if (decided.ok) assert.equal(decided.awardedXp, 0);
  assert.equal(db.state.goals['goal-1'].completed, true);
  assert.equal(db.state.users['user-1'].xp, 10);
});
