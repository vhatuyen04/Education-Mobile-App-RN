import assert from 'node:assert/strict';
import test from 'node:test';

import { AntiFarmStale, antiFarmFingerprint, settleApprovalRewards } from '../src/goals/antiFarm.ts';
import {
  applyProofDecision,
  type LockedGoalReward,
  type LockedProofAttempt,
  type LockedUserStreak,
  type ProofApprovalDb,
  type ProofDecisionInput,
  type RankFieldName,
} from '../src/goals/proofApproval.ts';

type UserRow = LockedUserStreak & {
  xp: number;
  sportScore: number;
  academyScore: number;
  entertainmentScore: number;
};

type GoalRow = LockedGoalReward & { rankField: RankFieldName | null };
type AttemptRow = LockedProofAttempt;

type DbState = {
  users: Record<string, UserRow>;
  goals: Record<string, GoalRow>;
  attempts: Record<string, AttemptRow>;
};

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

function createMemoryDb(initial: DbState) {
  const state = clone(initial);
  let active = 0;
  const mutexes = new Map<string, Mutex>();
  const mutex = (key: string) => {
    let found = mutexes.get(key);
    if (!found) {
      found = new Mutex();
      mutexes.set(key, found);
    }
    return found;
  };

  async function transaction<T>(run: (db: ProofApprovalDb) => Promise<T>): Promise<T> {
    active += 1;
    const txId = Symbol('tx');
    const releases: Array<() => void> = [];
    const writes: DbState = { users: {}, goals: {}, attempts: {} };
    const dirty = { users: new Set<string>(), goals: new Set<string>(), attempts: new Set<string>() };

    async function hold<TRow>(key: string, read: () => TRow | undefined, slot: Record<string, TRow>, id: string): Promise<TRow | null> {
      releases.push(await mutex(key).acquire(txId));
      if (!slot[id]) {
        const current = read();
        if (!current) return null;
        slot[id] = clone(current);
      }
      return clone(slot[id]);
    }

    const db: ProofApprovalDb = {
      lockAttempt(attemptId) {
        return hold(`attempt:${attemptId}`, () => state.attempts[attemptId], writes.attempts, attemptId);
      },
      lockGoal(goalId, userId) {
        return hold(
          `goal:${goalId}`,
          () => {
            const goal = state.goals[goalId];
            if (!goal || goal.userId !== userId) return undefined;
            return goal;
          },
          writes.goals,
          goalId
        );
      },
      lockUser(userId) {
        return hold(`user:${userId}`, () => state.users[userId], writes.users, userId);
      },
      async updateAttempt(attemptId, data) {
        const row = writes.attempts[attemptId];
        if (!row || row.status !== 'PENDING_REVIEW') return 0;
        Object.assign(row, data);
        dirty.attempts.add(attemptId);
        return 1;
      },
      async markGoalCompleted(goalId, userId) {
        const goal = writes.goals[goalId];
        if (!goal || goal.userId !== userId || goal.completed || goal.failedAt) return 0;
        goal.completed = true;
        dirty.goals.add(goalId);
        return 1;
      },
      async addUserRewards(userId, delta) {
        const user = writes.users[userId];
        if (!user) return;
        if (delta.xp > 0) user.xp += delta.xp;
        if (delta.points > 0 && delta.scoreField) user[delta.scoreField] += delta.points;
        dirty.users.add(userId);
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
      for (const id of dirty.attempts) state.attempts[id] = writes.attempts[id];
      return result;
    } finally {
      active -= 1;
      for (const release of releases.reverse()) release();
    }
  }

  return { state, transaction, active: () => active };
}

function user(partial: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-1',
    xp: 0,
    sportScore: 0,
    academyScore: 0,
    entertainmentScore: 0,
    goalStreakDays: 2,
    lastGoalCompletedAt: new Date('2026-01-01T12:00:00.000Z'),
    ...partial,
  };
}

function goal(partial: Partial<GoalRow> = {}): GoalRow {
  return {
    id: 'goal-1',
    userId: 'user-1',
    completed: false,
    failedAt: null,
    rankField: 'Sport',
    title: 'Run',
    description: null,
    requirementSource: 'AI',
    difficultyScore: 40,
    pointsAwarded: 8,
    xpAwarded: 8,
    ...partial,
  };
}

function attempt(partial: Partial<AttemptRow> = {}): AttemptRow {
  return {
    id: 'attempt-1',
    userId: 'user-1',
    goalId: 'goal-1',
    status: 'PENDING_REVIEW',
    awardedPoints: 0,
    awardedXp: 0,
    ...partial,
  };
}

function approve(attemptId: string, goalId = 'goal-1'): ProofDecisionInput {
  return { attemptId, goalId, userId: 'user-1', decision: 'APPROVE', feedback: 'ok', reviewer: 'admin' };
}

const day1 = new Date('2026-01-02T12:00:00.000Z');
const day2 = new Date('2026-01-03T12:00:00.000Z');

test('concurrent approvals of one goal award once', async () => {
  const db = createMemoryDb({
    users: { 'user-1': user() },
    goals: { 'goal-1': goal() },
    attempts: {
      'attempt-1': attempt(),
      'attempt-2': attempt({ id: 'attempt-2' }),
    },
  });
  const rewards = async () => ({ points: 8, xp: 8 });
  const [first, second] = await Promise.all([
    db.transaction(tx => applyProofDecision(tx, approve('attempt-1'), rewards, day1)),
    db.transaction(tx => applyProofDecision(tx, approve('attempt-2'), rewards, day1)),
  ]);
  const awarded = [first, second].filter(result => result.ok && result.awardedXp === 8);
  assert.equal(awarded.length, 1);
  assert.equal(db.state.users['user-1'].xp, 8);
  assert.equal(db.state.users['user-1'].sportScore, 8);
  assert.equal(db.state.goals['goal-1'].completed, true);
  assert.equal(db.state.users['user-1'].goalStreakDays, 3);
  assert.equal(db.state.attempts['attempt-1'].status, 'APPROVED');
  assert.equal(db.state.attempts['attempt-2'].status, 'APPROVED');
});

test('a failed approval rolls back and a retry awards once', async () => {
  const db = createMemoryDb({
    users: { 'user-1': user({ goalStreakDays: 0, lastGoalCompletedAt: null }) },
    goals: { 'goal-1': goal({ pointsAwarded: 4, xpAwarded: 9 }) },
    attempts: { 'attempt-1': attempt() },
  });

  await assert.rejects(() =>
    db.transaction(async tx => {
      const failing: ProofApprovalDb = {
        ...tx,
        markGoalCompleted: async (goalId, userId) => {
          const count = await tx.markGoalCompleted(goalId, userId);
          throw new Error(`write failed after claim ${count}`);
        },
      };
      return applyProofDecision(failing, approve('attempt-1'), async () => ({ points: 4, xp: 9 }), day1);
    })
  );
  assert.equal(db.state.attempts['attempt-1'].status, 'PENDING_REVIEW');
  assert.equal(db.state.goals['goal-1'].completed, false);
  assert.equal(db.state.users['user-1'].xp, 0);
  assert.equal(db.state.users['user-1'].goalStreakDays, 0);

  const retried = await db.transaction(tx => applyProofDecision(tx, approve('attempt-1'), async () => ({ points: 4, xp: 9 }), day1));
  assert.equal(retried.ok, true);
  if (retried.ok) assert.equal(retried.awardedXp, 9);
  assert.equal(db.state.users['user-1'].xp, 9);
  assert.equal(db.state.goals['goal-1'].completed, true);
  assert.equal(db.state.attempts['attempt-1'].status, 'APPROVED');

  const again = await db.transaction(tx => applyProofDecision(tx, approve('attempt-1'), async () => ({ points: 4, xp: 9 }), day2));
  assert.equal(again.ok, false);
  assert.equal(db.state.users['user-1'].xp, 9);
  assert.equal(db.state.users['user-1'].goalStreakDays, 1);
});

test('genuine zero rewards still complete the goal once', async () => {
  const db = createMemoryDb({
    users: { 'user-1': user({ xp: 15, sportScore: 3 }) },
    goals: { 'goal-1': goal({ pointsAwarded: 0, xpAwarded: 0 }) },
    attempts: { 'attempt-1': attempt() },
  });
  const decided = await db.transaction(tx => applyProofDecision(tx, approve('attempt-1'), async () => ({ points: 0, xp: 0 }), day1));
  assert.equal(decided.ok, true);
  if (decided.ok) {
    assert.equal(decided.awardedPoints, 0);
    assert.equal(decided.awardedXp, 0);
    assert.equal(decided.completedGoal, true);
  }
  assert.equal(db.state.users['user-1'].xp, 15);
  assert.equal(db.state.users['user-1'].sportScore, 3);
  assert.equal(db.state.goals['goal-1'].completed, true);
  assert.equal(db.state.attempts['attempt-1'].awardedXp, 0);
  assert.equal(db.state.users['user-1'].goalStreakDays, 3);

  const retry = await db.transaction(tx => applyProofDecision(tx, approve('attempt-1'), async () => ({ points: 20, xp: 20 }), day2));
  assert.equal(retry.ok, false);
  assert.equal(db.state.users['user-1'].xp, 15);
  assert.equal(db.state.users['user-1'].goalStreakDays, 3);
});

test('concurrent completions keep both streak days', async () => {
  const db = createMemoryDb({
    users: { 'user-1': user() },
    goals: {
      'goal-1': goal(),
      'goal-2': goal({ id: 'goal-2', title: 'Swim' }),
    },
    attempts: {
      'attempt-1': attempt(),
      'attempt-2': attempt({ id: 'attempt-2', goalId: 'goal-2' }),
    },
  });
  let releaseHold: () => void = () => {};
  const holding = new Promise<void>(resolve => {
    releaseHold = resolve;
  });
  const first = db.transaction(tx =>
    applyProofDecision(
      tx,
      approve('attempt-1'),
      async () => {
        releaseHold();
        await new Promise(resolve => setTimeout(resolve, 20));
        return { points: 1, xp: 1 };
      },
      day1
    )
  );
  await holding;
  const second = db.transaction(tx =>
    applyProofDecision(tx, approve('attempt-2', 'goal-2'), async () => ({ points: 1, xp: 1 }), day2)
  );
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.ok && right.ok, true);
  assert.equal(db.state.users['user-1'].goalStreakDays, 4);
  assert.equal(db.state.users['user-1'].xp, 2);
  assert.equal(db.state.goals['goal-1'].completed, true);
  assert.equal(db.state.goals['goal-2'].completed, true);
});

test('rejection leaves the goal active so it can be resubmitted', async () => {
  const db = createMemoryDb({
    users: { 'user-1': user() },
    goals: { 'goal-1': goal() },
    attempts: { 'attempt-1': attempt() },
  });
  const rejected = await db.transaction(tx =>
    applyProofDecision(
      tx,
      { attemptId: 'attempt-1', decision: 'REJECT', feedback: 'Too short', reviewer: 'AI' },
      async () => ({ points: 8, xp: 8 }),
      day1
    )
  );
  assert.equal(rejected.ok, true);
  if (rejected.ok) assert.equal(rejected.status, 'REJECTED');
  assert.equal(db.state.goals['goal-1'].completed, false);
  assert.equal(db.state.users['user-1'].xp, 0);
  assert.equal(db.state.attempts['attempt-1'].status, 'REJECTED');

  db.state.attempts['attempt-1'].status = 'PENDING_REVIEW';
  const approved = await db.transaction(tx => applyProofDecision(tx, approve('attempt-1'), async () => ({ points: 8, xp: 8 }), day1));
  assert.equal(approved.ok, true);
  if (approved.ok) assert.equal(approved.awardedPoints, 8);
  assert.equal(db.state.goals['goal-1'].completed, true);
  assert.equal(db.state.users['user-1'].sportScore, 8);
});

function recentCompleted(state: DbState, goalId: string) {
  const goal = state.goals[goalId];
  return Object.values(state.goals)
    .filter(item => item.id !== goalId && item.userId === goal.userId && item.completed && item.requirementSource === 'AI' && item.rankField === goal.rankField)
    .map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      difficultyScore: item.difficultyScore,
    }));
}

test('a slow anti-farm decision stays outside the row locks and is rechecked', async () => {
  const db = createMemoryDb({
    users: { 'user-1': user({ xp: 0, sportScore: 0, goalStreakDays: 0, lastGoalCompletedAt: null }) },
    goals: {
      'goal-1': goal({ title: 'Run daily' }),
      'goal-2': goal({ id: 'goal-2', title: 'Run daily' }),
    },
    attempts: { 'attempt-1': attempt() },
  });
  let sawLocks = false;
  const decided = await settleApprovalRewards({
    maxAttempts: 3,
    load: async () => ({ goal: clone(db.state.goals['goal-1']), recent: recentCompleted(db.state, 'goal-1') }),
    decide: async (_goal, recent) => {
      if (db.active() !== 0) sawLocks = true;
      await new Promise(resolve => setTimeout(resolve, 30));
      if (db.active() !== 0) sawLocks = true;
      return recent.length ? { points: 0, xp: 0 } : { points: 8, xp: 8 };
    },
    commit: (rewards, fingerprint) => {
      db.state.goals['goal-2'].completed = true;
      return db.transaction(tx =>
        applyProofDecision(tx, approve('attempt-1'), async locked => {
          const recentNow = recentCompleted(db.state, locked.id);
          if (fingerprint !== null && antiFarmFingerprint(locked, recentNow) !== fingerprint) throw new AntiFarmStale();
          return rewards;
        }, day1)
      );
    },
  });
  assert.equal(sawLocks, false);
  assert.equal(decided.ok, true);
  if (decided.ok) {
    assert.equal(decided.awardedXp, 0);
    assert.equal(decided.completedGoal, true);
  }
  assert.equal(db.state.users['user-1'].xp, 0);
  assert.equal(db.state.goals['goal-1'].completed, true);
  assert.equal(db.state.attempts['attempt-1'].status, 'APPROVED');
});

test('concurrent similar approvals cannot both skip anti-farm', async () => {
  const db = createMemoryDb({
    users: { 'user-1': user({ xp: 0, sportScore: 0, goalStreakDays: 0, lastGoalCompletedAt: null }) },
    goals: {
      'goal-1': goal({ title: 'Run daily', pointsAwarded: 8, xpAwarded: 8 }),
      'goal-2': goal({ id: 'goal-2', title: 'Run daily', pointsAwarded: 8, xpAwarded: 8 }),
    },
    attempts: {
      'attempt-1': attempt(),
      'attempt-2': attempt({ id: 'attempt-2', goalId: 'goal-2' }),
    },
  });
  let modelInsideLock = false;
  const approveGoal = (attemptId: string, goalId: string) =>
    settleApprovalRewards({
      maxAttempts: 3,
      load: async () => ({ goal: clone(db.state.goals[goalId]), recent: recentCompleted(db.state, goalId) }),
      decide: async (goal, recent) => {
        if (db.active() !== 0) modelInsideLock = true;
        await new Promise(resolve => setTimeout(resolve, 25));
        const farm = recent.some(item => item.title === goal.title);
        return farm ? { points: 0, xp: 0 } : { points: 8, xp: 8 };
      },
      commit: (rewards, fingerprint) =>
        db.transaction(tx =>
          applyProofDecision(tx, approve(attemptId, goalId), async locked => {
            const recentNow = recentCompleted(db.state, locked.id);
            if (fingerprint !== null && antiFarmFingerprint(locked, recentNow) !== fingerprint) throw new AntiFarmStale();
            return rewards;
          }, day1)
        ),
    });
  const [first, second] = await Promise.all([approveGoal('attempt-1', 'goal-1'), approveGoal('attempt-2', 'goal-2')]);
  assert.equal(modelInsideLock, false);
  assert.equal(first.ok && second.ok, true);
  assert.equal(db.state.users['user-1'].xp, 8);
  assert.equal(db.state.users['user-1'].sportScore, 8);
  assert.equal(db.state.goals['goal-1'].completed, true);
  assert.equal(db.state.goals['goal-2'].completed, true);
  const awarded = [db.state.attempts['attempt-1'].awardedXp, db.state.attempts['attempt-2'].awardedXp].sort();
  assert.deepEqual(awarded, [0, 8]);
});
