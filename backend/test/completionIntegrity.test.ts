import assert from 'node:assert/strict';
import test from 'node:test';

import { authoritativeSchedulingTimeZone, dashboardProgressPercent, instantCivilDate, utcMidnightFromCivil } from '../src/goals/recurrenceSchedule.ts';
import { completionToggleDecision } from '../src/goals/stepLifecycle.ts';

const zone = 'Europe/Budapest';
const goalCreated = new Date('2026-01-01T10:00:00.000Z');
const goalDue = '2026-12-31T00:00:00.000Z';

function weekday(civil: string): number {
  return new Date(`${civil}T00:00:00.000Z`).getUTCDay();
}

function dailyStep(extra: Record<string, unknown> = {}) {
  return { id: 'daily', repeat: 'daily', createdAt: goalCreated, ...extra };
}

test('the scheduling zone is configured on the server, not chosen by an invalid client name', () => {
  assert.equal(authoritativeSchedulingTimeZone('Europe/Budapest'), 'Europe/Budapest');
  assert.notEqual(authoritativeSchedulingTimeZone('Not/AZone'), 'Not/AZone');
});

test('only the server civil day of an active scheduled step can change', () => {
  const now = new Date('2026-11-23T22:59:59.000Z');
  const today = instantCivilDate(now, zone);
  assert.equal(today, '2026-11-23');
  const allowed = completionToggleDecision({
    now,
    authoritativeTimeZone: zone,
    requestedDate: `${today}T00:00:00.000Z`,
    step: dailyStep(),
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
  });
  assert.equal(allowed.ok, true);
  if (!allowed.ok) return;
  assert.equal(allowed.civilToday, today);
  assert.equal(allowed.storedDate.toISOString(), `${today}T00:00:00.000Z`);

  const legacyToday = completionToggleDecision({
    now,
    authoritativeTimeZone: zone,
    requestedDate: '2026-11-23T22:30:00.000Z',
    step: dailyStep(),
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
  });
  assert.equal(legacyToday.ok, true);

  const yesterday = completionToggleDecision({
    now,
    authoritativeTimeZone: zone,
    requestedDate: '2026-11-22T00:00:00.000Z',
    step: dailyStep(),
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
  });
  assert.equal(yesterday.ok, false);
  if (!yesterday.ok) assert.equal(yesterday.error, 'Past occurrences are read-only');

  const tomorrow = completionToggleDecision({
    now,
    authoritativeTimeZone: zone,
    requestedDate: '2026-11-24T00:00:00.000Z',
    step: dailyStep(),
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
  });
  assert.equal(tomorrow.ok, false);
  if (!tomorrow.ok) assert.equal(tomorrow.error, 'Future occurrences are read-only');

  const otherWeekday = (weekday(today) + 1) % 7;
  const unscheduled = completionToggleDecision({
    now,
    authoritativeTimeZone: zone,
    requestedDate: `${today}T00:00:00.000Z`,
    step: { id: 'week', repeat: 'weekly', repeatDay: otherWeekday, createdAt: goalCreated },
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
  });
  assert.equal(unscheduled.ok, false);
  if (!unscheduled.ok) assert.equal(unscheduled.error, 'This step is not scheduled today');

  const archived = completionToggleDecision({
    now,
    authoritativeTimeZone: zone,
    requestedDate: `${today}T00:00:00.000Z`,
    step: dailyStep({ archivedAt: now }),
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
  });
  assert.equal(archived.ok, false);
  if (!archived.ok) assert.equal(archived.error, 'Archived steps cannot be changed');
});

test('Budapest midnight and both DST transitions follow the server zone', () => {
  const afterMidnight = new Date('2026-11-23T23:00:00.000Z');
  assert.equal(instantCivilDate(afterMidnight, zone), '2026-11-24');
  const crossed = completionToggleDecision({
    now: afterMidnight,
    authoritativeTimeZone: zone,
    requestedDate: '2026-11-23T00:00:00.000Z',
    step: dailyStep(),
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
  });
  assert.equal(crossed.ok, false);
  if (!crossed.ok) assert.equal(crossed.error, 'Past occurrences are read-only');

  const springBefore = new Date('2026-03-29T00:30:00.000Z');
  const springAfter = new Date('2026-03-29T01:30:00.000Z');
  assert.equal(instantCivilDate(springBefore, zone), '2026-03-29');
  assert.equal(instantCivilDate(springAfter, zone), '2026-03-29');
  const autumnBefore = new Date('2026-10-25T00:30:00.000Z');
  const autumnAfter = new Date('2026-10-25T01:30:00.000Z');
  assert.equal(instantCivilDate(autumnBefore, zone), '2026-10-25');
  assert.equal(instantCivilDate(autumnAfter, zone), '2026-10-25');

  const losAngelesDay = instantCivilDate(afterMidnight, 'America/Los_Angeles');
  assert.equal(losAngelesDay, '2026-11-23');
  const serverWins = completionToggleDecision({
    now: afterMidnight,
    authoritativeTimeZone: zone,
    requestedDate: `${losAngelesDay}T00:00:00.000Z`,
    step: dailyStep(),
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
  });
  assert.equal(serverWins.ok, false);
});

test('two timestamps on one civil day count as one DONE, and 201 steps all count', () => {
  const oneDay = dashboardProgressPercent({
    steps: [{ id: 'daily', repeat: 'daily', createdAt: new Date('2026-11-23T10:00:00.000Z') }],
    completions: [
      { stepId: 'daily', date: '2026-11-23T00:00:00.000Z' },
      { stepId: 'daily', date: '2026-11-23T22:59:59.999Z' },
    ],
    goalCreatedAt: new Date('2026-11-23T10:00:00.000Z'),
    goalDueAt: utcMidnightFromCivil('2026-11-23'),
    legacyTimeZone: zone,
  });
  assert.equal(oneDay, 100);

  const steps = Array.from({ length: 201 }, (_, index) => ({
    id: `step-${index}`,
    repeat: index === 200 ? 'daily' : null,
    createdAt: new Date('2026-11-23T10:00:00.000Z'),
  }));
  const full = dashboardProgressPercent({
    steps,
    completions: [{ stepId: 'step-200', date: '2026-11-23T00:00:00.000Z' }],
    goalCreatedAt: new Date('2026-11-23T10:00:00.000Z'),
    goalDueAt: utcMidnightFromCivil('2026-11-23'),
    legacyTimeZone: zone,
  });
  const truncated = dashboardProgressPercent({
    steps: steps.slice(0, 200),
    completions: [{ stepId: 'step-200', date: '2026-11-23T00:00:00.000Z' }],
    goalCreatedAt: new Date('2026-11-23T10:00:00.000Z'),
    goalDueAt: utcMidnightFromCivil('2026-11-23'),
    legacyTimeZone: zone,
  });
  assert.equal(full, 100);
  assert.equal(truncated, 0);
});
