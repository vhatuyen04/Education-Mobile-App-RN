import assert from 'node:assert/strict';
import test from 'node:test';
import type { Server } from 'node:http';

import { signAccessToken } from '../src/auth/tokens.ts';
import { addCivilDays } from '../src/goals/stepLifecycle.ts';
import { authoritativeSchedulingTimeZone, instantCivilDate } from '../src/goals/recurrenceSchedule.ts';
import { createServer } from '../src/serverFactory.ts';
import { prisma } from '../src/utils/prisma.ts';

const stamp = Date.now();
const ownerEmail = `completion-http-${stamp}@example.test`;
const otherEmail = `completion-http-other-${stamp}@example.test`;

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
  const payload = text ? JSON.parse(text) as { error?: string; goal?: { id: string; progressPct: number }; step?: { id: string; archivedAt?: string | null }; steps?: unknown[]; goals?: Array<{ id: string; progressPct: number }>; nextGoal?: { id: string; progressPct: number } | null } : {};
  return { status: response.status, payload };
}

test('HTTP completion, progress, and the full step list survive a server restart', async () => {
  const zone = authoritativeSchedulingTimeZone();
  const today = instantCivilDate(new Date(), zone);
  const yesterday = addCivilDays(today, -1);
  const tomorrow = addCivilDays(today, 1);
  assert.ok(yesterday && tomorrow);
  const owner = await prisma.user.create({ data: { email: ownerEmail, passwordHash: 'not-a-login' } });
  const other = await prisma.user.create({ data: { email: otherEmail, passwordHash: 'not-a-login' } });
  const token = signAccessToken(owner.id, 'USER');
  const otherToken = signAccessToken(other.id, 'USER');
  let server: Server | null = null;
  try {
    const started = await listen(createServer().app);
    server = started.server;
    const base = started.base;
    const created = await api(base, token, 'POST', '/auth/goals', {
      title: 'Completion integrity',
      dueAt: `${today}T00:00:00.000Z`,
    });
    assert.equal(created.status, 201);
    const goalId = created.payload.goal?.id ?? '';
    const stepResponse = await api(base, token, 'POST', `/auth/goals/${goalId}/steps`, { text: 'Daily', repeat: 'daily' });
    assert.equal(stepResponse.status, 201);
    const stepId = stepResponse.payload.step?.id ?? '';
    const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    const weekly = await api(base, token, 'POST', `/auth/goals/${goalId}/steps`, {
      text: 'Other weekday',
      repeat: 'weekly',
      repeatDay: (weekday + 1) % 7,
    });
    assert.equal(weekly.status, 201);

    const done = await api(base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/completion`, {
      date: `${today}T00:00:00.000Z`,
      done: true,
      timeZone: 'Pacific/Kiritimati',
    });
    assert.equal(done.status, 200);
    const again = await api(base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/completion`, {
      date: `${today}T00:00:00.000Z`,
      done: true,
      timeZone: 'America/Los_Angeles',
    });
    assert.equal(again.status, 200);
    assert.equal(await prisma.goalStepCompletion.count({ where: { stepId } }), 1);
    await prisma.goalStepCompletion.create({ data: { stepId, date: new Date(`${today}T12:00:00.000Z`) } });
    const undo = await api(base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/completion`, { date: `${today}T00:00:00.000Z`, done: false });
    assert.equal(undo.status, 200);
    assert.equal(await prisma.goalStepCompletion.count({ where: { stepId } }), 0);
    const redone = await api(base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/completion`, { date: `${today}T00:00:00.000Z`, done: true });
    assert.equal(redone.status, 200);

    const past = await api(base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/completion`, { date: `${yesterday}T00:00:00.000Z`, done: true });
    assert.equal(past.status, 409);
    assert.equal(past.payload.error, 'Past occurrences are read-only');
    const future = await api(base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/completion`, { date: `${tomorrow}T00:00:00.000Z`, done: true });
    assert.equal(future.status, 409);
    assert.equal(future.payload.error, 'Future occurrences are read-only');
    const unscheduled = await api(base, token, 'POST', `/auth/goals/${goalId}/steps/${weekly.payload.step?.id}/completion`, { date: `${today}T00:00:00.000Z`, done: true });
    assert.equal(unscheduled.status, 409);
    assert.equal(unscheduled.payload.error, 'This step is not scheduled today');
    assert.equal(await prisma.goalStepCompletion.count({ where: { stepId } }), 1);

    const replaced = await api(base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/replace`, {
      text: 'Replacement',
      repeat: 'daily',
      timeZone: 'Pacific/Kiritimati',
    });
    assert.equal(replaced.status, 201);
    const replacementId = replaced.payload.step?.id ?? '';
    assert.notEqual(replacementId, stepId);
    const archivedToggle = await api(base, token, 'POST', `/auth/goals/${goalId}/steps/${stepId}/completion`, { date: `${today}T00:00:00.000Z`, done: false });
    assert.equal(archivedToggle.status, 409);
    assert.equal(archivedToggle.payload.error, 'Archived steps cannot be changed');
    assert.equal(await prisma.goalStepCompletion.count({ where: { stepId } }), 1);

    const oldHistory = await api(base, token, 'GET', `/auth/goals/${goalId}/steps/${stepId}/history`);
    assert.equal(oldHistory.status, 200);
    const removed = await api(base, token, 'DELETE', `/auth/goals/${goalId}/steps/${replacementId}`);
    assert.equal(removed.status, 200);
    const newHistory = await api(base, token, 'GET', `/auth/goals/${goalId}/steps/${replacementId}/history`);
    assert.equal(newHistory.status, 200);
    const forbidden = await api(base, otherToken, 'GET', `/auth/goals/${goalId}/steps/${stepId}/history`);
    assert.equal(forbidden.status, 404);

    const listed = await api(base, token, 'GET', '/auth/goals');
    const detail = await api(base, token, 'GET', `/auth/goals/${goalId}`);
    const dashboard = await api(base, token, 'GET', '/auth/dashboard');
    const listPct = listed.payload.goals?.find(goal => goal.id === goalId)?.progressPct;
    assert.equal(typeof listPct, 'number');
    assert.ok((listPct ?? 0) > 0);
    assert.equal(detail.payload.goal?.progressPct, listPct);
    assert.equal(dashboard.payload.nextGoal?.progressPct, listPct);

    await close(server);
    server = null;
    const restarted = await listen(createServer().app);
    server = restarted.server;
    const persisted = await api(restarted.base, token, 'GET', `/auth/goals/${goalId}/steps/${stepId}/history`);
    assert.equal(persisted.status, 200);
    assert.equal(await prisma.goalStepCompletion.count({ where: { stepId } }), 1);

    await prisma.goalStep.createMany({
      data: Array.from({ length: 200 }, (_, index) => ({ goalId, text: `Filler ${index}`, order: index })),
    });
    const counted = await api(restarted.base, token, 'GET', `/auth/goals/${goalId}/steps`);
    assert.equal(counted.status, 200);
    assert.ok((counted.payload.steps?.length ?? 0) >= 201);

    const raceStep = await api(restarted.base, token, 'POST', `/auth/goals/${goalId}/steps`, { text: 'Race', repeat: 'daily' });
    assert.equal(raceStep.status, 201);
    const raceId = raceStep.payload.step?.id ?? '';
    const [raceReplace, raceDelete] = await Promise.all([
      api(restarted.base, token, 'POST', `/auth/goals/${goalId}/steps/${raceId}/replace`, { text: 'Race next', repeat: 'daily' }),
      api(restarted.base, token, 'DELETE', `/auth/goals/${goalId}/steps/${raceId}`),
    ]);
    assert.ok([raceReplace.status, raceDelete.status].some(status => status >= 200 && status < 300));
    const raceRow = await prisma.goalStep.findFirst({ where: { id: raceId }, select: { archivedAt: true } });
    assert.ok(raceRow?.archivedAt);
    const raceCopies = await prisma.goalStep.count({ where: { replacesStepId: raceId } });
    assert.ok(raceCopies <= 1);
  } finally {
    if (server) await close(server).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, otherEmail] } } });
    await prisma.$disconnect();
  }
});
