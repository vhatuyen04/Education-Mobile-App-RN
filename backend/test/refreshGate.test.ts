import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionSnapshot } from '../../frontend/src/auth/refreshGate.ts';

const { createSessionGate } = await import('../../frontend/src/auth/refreshGate.ts');
const { createSessionCoordinator } = await import('../../frontend/src/auth/sessionCoordinator.ts');

function session(accessToken: string, refreshToken = 'refresh-1'): SessionSnapshot {
  return {
    accessToken,
    refreshToken,
    user: { id: 'user-1', email: 'user@example.com', name: 'User', role: 'USER' },
  };
}

test('renews an expired access token once for several simultaneous requests', async () => {
  let current = session('expired-access');
  let refreshes = 0;
  const gate = createSessionGate({
    getSession: () => current,
    getGeneration: () => 0,
    setSession: async next => {
      current = next;
    },
    clearSession: async () => {
      current = null as unknown as SessionSnapshot;
    },
    refresh: async refreshToken => {
      refreshes += 1;
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(refreshToken, 'refresh-1');
      return session('fresh-access', 'refresh-2');
    },
  });

  const run = async (token: string) => {
    if (token === 'expired-access') throw new Error('Invalid access token');
    return token;
  };

  const results = await Promise.all([gate.withAuthRetry(run), gate.withAuthRetry(run), gate.withAuthRetry(run)]);
  assert.deepEqual(results, ['fresh-access', 'fresh-access', 'fresh-access']);
  assert.equal(refreshes, 1);
  assert.equal(current.refreshToken, 'refresh-2');
});

test('clears the session when refresh is expired, invalid, or revoked', async () => {
  let current: SessionSnapshot | null = session('expired-access', 'expired-refresh');
  let runs = 0;
  const gate = createSessionGate({
    getSession: () => current,
    getGeneration: () => 0,
    setSession: async next => {
      current = next;
    },
    clearSession: async () => {
      current = null;
    },
    refresh: async () => {
      throw new Error('Invalid refresh token');
    },
  });

  await assert.rejects(
    gate.withAuthRetry(async () => {
      runs += 1;
      throw new Error('Invalid access token');
    }),
    /Invalid refresh token/
  );
  assert.equal(runs, 1);
  assert.equal(current, null);
});

test('restores an app session that has an expired access token and a valid refresh token', async () => {
  let current: SessionSnapshot | null = session('stored-expired-access', 'stored-refresh');
  let refreshes = 0;
  const gate = createSessionGate({
    getSession: () => current,
    getGeneration: () => 0,
    setSession: async next => {
      current = next;
    },
    clearSession: async () => {
      current = null;
    },
    refresh: async () => {
      refreshes += 1;
      return session('restored-access', 'stored-refresh-next');
    },
  });

  const result = await gate.withAuthRetry(async token => {
    if (token === 'stored-expired-access') throw new Error('Invalid access token');
    return `ok:${token}`;
  });

  assert.equal(result, 'ok:restored-access');
  assert.equal(refreshes, 1);
  assert.equal(current?.accessToken, 'restored-access');
});

test('discards a refresh result after logout, including a late secure-store write', async () => {
  let releaseWrite: () => void = () => {};
  const writeReached = new Promise<void>(resolve => {
    releaseWrite = resolve;
  });
  let disk: string | null = null;
  let writeStarted = false;
  const coordinator = createSessionCoordinator({
    persist: async next => {
      if (next) {
        writeStarted = true;
        await writeReached;
        disk = next.accessToken;
        return;
      }
      disk = null;
    },
  });
  coordinator.adoptSession(session('expired-access', 'refresh-old'));
  const gate = createSessionGate({
    getSession: () => coordinator.getSession(),
    getGeneration: () => coordinator.currentGeneration(),
    setSession: (next, generation) => coordinator.replaceSession(next, generation),
    clearSession: () => coordinator.dropSession(),
    refresh: async () => session('fresh-access', 'refresh-new'),
  });

  const pending = gate.withAuthRetry(async token => {
    if (token === 'expired-access') throw new Error('Invalid access token');
    return token;
  });
  await new Promise<void>(resolve => {
    const timer = setInterval(() => {
      if (writeStarted) {
        clearInterval(timer);
        resolve();
      }
    }, 1);
  });
  const loggedOut = coordinator.dropSession();
  releaseWrite();
  await assert.rejects(pending, /Session expired/);
  await loggedOut;
  assert.equal(coordinator.getSession(), null);
  assert.equal(disk, null);
});

test('discards a refresh result after a newer session replaces it', async () => {
  const coordinator = createSessionCoordinator({
    persist: async () => {},
  });
  coordinator.adoptSession(session('expired-access', 'refresh-old'));
  let releaseRefresh: () => void = () => {};
  const refreshStarted = new Promise<void>(resolve => {
    releaseRefresh = resolve;
  });
  const gate = createSessionGate({
    getSession: () => coordinator.getSession(),
    getGeneration: () => coordinator.currentGeneration(),
    setSession: (next, generation) => coordinator.replaceSession(next, generation),
    clearSession: () => coordinator.dropSession(),
    refresh: async () => {
      releaseRefresh();
      await new Promise(resolve => setTimeout(resolve, 20));
      return session('stale-refresh', 'refresh-stale');
    },
  });

  const pending = gate.withAuthRetry(async token => {
    if (token === 'expired-access') throw new Error('Invalid access token');
    return token;
  });
  await refreshStarted;
  await coordinator.replaceSession(session('replacement', 'refresh-replacement'));
  await assert.rejects(pending, /Session expired/);
  assert.equal(coordinator.getSession()?.accessToken, 'replacement');
});
