import assert from 'node:assert/strict';
import test from 'node:test';
import type { Server } from 'node:http';

import { signAccessToken } from '../src/auth/tokens.ts';
import { addCivilDays } from '../src/goals/stepLifecycle.ts';
import { authoritativeSchedulingTimeZone, instantCivilDate } from '../src/goals/recurrenceSchedule.ts';
import { createServer } from '../src/serverFactory.ts';
import { prisma } from '../src/utils/prisma.ts';

const stamp = Date.now();
const email = `custom-dates-${stamp}@example.test`;

async function listen(app: ReturnType<typeof createServer>['app']): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}

async function api(base: string, token: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as {
    error?: string;
    goal?: { id: string; progressPct: number };
    step?: { id: string; repeat?: string | null; customDates?: string[]; archivedAt?: string | null; effectiveUntil?: string | null };
    archivedStepId?: string;
  } : {};
  return { status: response.status, payload };
}

test('HTTP custom dates create, reject, complete, replace, and archive', async () => {
  const zone = authoritativeSchedulingTimeZone();
  const today = instantCivilDate(new Date(), zone);
  const yesterday = addCivilDays(today, -1);
  const tomorrow = addCivilDays(today, 1);
  const later = addCivilDays(today, 3);
  assert.ok(yesterday && tomorrow && later);
  const owner = await prisma.user.create({ data: { email, passwordHash: 'not-a-login' } });
  const token = signAccessToken(owner.id, 'USER');
  let server: Server | null = null;
  try {
    const started = await listen(createServer().app);
    server = started.server;
    const created = await api(started.base, token, 'POST', '/auth/goals', {
      title: 'Custom dates',
      dueAt: `${later}T00:00:00.000Z`,
    });
    assert.equal(created.status, 201);
    const goalId = created.payload.goal?.id ?? '';
    const empty = await api(started.base, token, 'POST', `/auth/goals/${goalId}/steps`, { text: 'Empty', repeat: 'custom', customDates: [] });
    assert.equal(empty.status, 400);
    const duplicate = await api(started.base, token, 'POST', `/auth/goals/${goalId}/steps`, { text: 'Dup', repeat: 'custom', customDates: [today, today] });
    assert.equal(duplicate.status, 400);
    const invalid = await api(started.base, token, 'POST', `/auth/goals/${goalId}/steps`, { text: 'Bad', repeat: 'custom', customDates: ['2026-02-31'] });
    assert.equal(invalid.status, 400);
    const past = await api(started.base, token, 'POST', `/auth/goals/${goalId}/steps`, { text: 'Past', repeat: 'custom', customDates: [yesterday, today] });
    assert.equal(past.status, 400);
    const after = await api(started.base, token, 'POST', `/auth/goals/${goalId}/steps`, { text: 'After', repeat: 'custom', customDates: [today, addCivilDays(later, 1) ?? later] });
    assert.equal(after.status, 400);
    const step = await api(started.base, token, 'POST', `/auth/goals/${goalId}/steps`, {
      text: 'Picked',
      repeat: 'custom',
      customDates: [later, today],
    });
    assert.equal(step.status, 201);
    assert.deepEqual(step.payload.step?.customDates, [today, later]);
    const stepId = step.payload.step?.id ?? '';
    const done = await api(started.base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/completion`, {
      date: `${today}T00:00:00.000Z`,
      done: true,
      timeZone: 'Pacific/Kiritimati',
    });
    assert.equal(done.status, 200);
    const undo = await api(started.base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/completion`, {
      date: `${today}T00:00:00.000Z`,
      done: false,
    });
    assert.equal(undo.status, 200);
    const redo = await api(started.base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/completion`, {
      date: `${today}T00:00:00.000Z`,
      done: true,
    });
    assert.equal(redo.status, 200);
    const offDay = await api(started.base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/completion`, {
      date: `${tomorrow}T00:00:00.000Z`,
      done: true,
    });
    assert.equal(offDay.status, 409);
    const future = await api(started.base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/completion`, {
      date: `${later}T00:00:00.000Z`,
      done: true,
    });
    assert.equal(future.status, 409);
    const replaced = await api(started.base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/replace`, {
      text: 'Picked again',
      repeat: 'custom',
      customDates: [today, tomorrow],
    });
    assert.equal(replaced.status, 201, replaced.payload.error);
    const removed = await api(started.base, token, 'DELETE', `/auth/goals/${goalId}/steps/${replaced.payload.step?.id}`);
    assert.equal(removed.status, 200);
    const history = await api(started.base, token, 'GET', `/auth/goals/${goalId}/steps/${stepId}/history`);
    assert.equal(history.status, 200);
  } finally {
    if (server) await close(server);
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
});
