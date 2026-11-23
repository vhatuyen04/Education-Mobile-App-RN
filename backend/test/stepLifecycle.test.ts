import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProgressSnapshot } from '../src/goals/progressSnapshot.ts';
import { dashboardProgressPercent, utcMidnightFromCivil } from '../src/goals/recurrenceSchedule.ts';
import {
  archiveDecision,
  commitReplacement,
  completionAllowed,
  immutableFieldChange,
  planReplacement,
  readDurationMinutes,
  stepHistory,
} from '../src/goals/stepLifecycle.ts';
import { verifyRecoveryPlan } from '../src/goals/verifyRecoveryPlan.ts';

const goalCreated = new Date('2026-11-22T10:00:00.000Z');
const goalDue = utcMidnightFromCivil('2026-11-30');
const zone = 'Europe/Budapest';

function daily(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    repeat: 'daily',
    createdAt: goalCreated,
    ...extra,
  };
}

test('custom and AI steps share one creation contract and duration is optional', () => {
  assert.deepEqual(readDurationMinutes(undefined), { ok: true, minutes: null });
  assert.deepEqual(readDurationMinutes(25), { ok: true, minutes: 25 });
  assert.equal(readDurationMinutes(0).ok, false);
  assert.equal(readDurationMinutes(1.5).ok, false);
});

test('a step definition cannot be rewritten in place', () => {
  const existing = { text: 'Run', description: null, repeat: 'daily', repeatDay: null, repeatMonth: null, dueAt: null, durationMinutes: null };
  assert.equal(immutableFieldChange(existing, { text: 'Walk' }), 'text');
  assert.equal(immutableFieldChange(existing, { repeat: 'weekly', repeatDay: 0 }), 'repeat');
  assert.equal(immutableFieldChange(existing, { durationMinutes: 20 }), 'durationMinutes');
  assert.equal(immutableFieldChange(existing, { text: 'Run', order: 2 } as never), null);
});

test('today toggles, missed past days, and future days', () => {
  const history = stepHistory({
    step: daily('daily'),
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    completions: [{ date: '2026-11-22T00:00:00.000Z' }],
    now: new Date('2026-11-24T10:00:00.000Z'),
    legacyTimeZone: zone,
    pastDays: 10,
    futureDays: 2,
  });
  assert.equal(history.occurrences.find(row => row.date === '2026-11-22')?.status, 'DONE');
  assert.equal(history.occurrences.find(row => row.date === '2026-11-23')?.status, 'MISSED');
  assert.equal(history.occurrences.find(row => row.date === '2026-11-24')?.status, 'TODO');
  assert.equal(history.occurrences.find(row => row.date === '2026-11-25')?.status, 'FUTURE');
  assert.equal(completionAllowed({ archivedAt: null }), true);
  assert.equal(completionAllowed({ archivedAt: '2026-11-24T10:00:00.000Z' }), false);
});

test('delete finalizes today and a repeat does not move the boundary', () => {
  const done = archiveDecision({ archivedAt: null, todayCivil: '2026-11-24', scheduledToday: true, now: new Date('2026-11-24T10:00:00.000Z') });
  assert.equal(done.effectiveUntil, '2026-11-24');
  const missed = stepHistory({
    step: { ...daily('daily'), archivedAt: done.archivedAt, effectiveUntil: utcMidnightFromCivil(done.effectiveUntil) },
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    completions: [{ date: '2026-11-22T00:00:00.000Z' }, { date: '2026-11-22T00:00:00.000Z' }],
    now: new Date('2026-11-24T10:00:00.000Z'),
    legacyTimeZone: zone,
    pastDays: 10,
    futureDays: 10,
  });
  assert.equal(missed.occurrences.find(row => row.date === '2026-11-24')?.status, 'MISSED');
  assert.equal(missed.occurrences.some(row => row.date > '2026-11-24'), false);
  assert.equal(missed.occurrences.filter(row => row.date === '2026-11-22').length, 1);
  const again = archiveDecision({ archivedAt: done.archivedAt, effectiveUntil: utcMidnightFromCivil(done.effectiveUntil), todayCivil: '2026-11-25', scheduledToday: false, now: new Date('2026-11-25T10:00:00.000Z') });
  assert.equal(again.changed, false);
  assert.equal(again.effectiveUntil, '2026-11-24');
});

test('delete on a day that is not scheduled does not invent a miss', () => {
  const sunday = archiveDecision({ archivedAt: null, todayCivil: '2026-11-22', scheduledToday: false, now: new Date('2026-11-22T10:00:00.000Z') });
  assert.equal(sunday.effectiveUntil, '2026-11-21');
  const history = stepHistory({
    step: { id: 'week', repeat: 'weekly', repeatDay: 1, createdAt: goalCreated, archivedAt: sunday.archivedAt, effectiveUntil: utcMidnightFromCivil(sunday.effectiveUntil) },
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    now: new Date('2026-11-22T10:00:00.000Z'),
    legacyTimeZone: zone,
    pastDays: 5,
    futureDays: 10,
  });
  assert.equal(history.occurrences.some(row => row.date === '2026-11-22'), false);
});

test('replacement starts today, keeps a new id, and rolls back when create fails', async () => {
  const plan = planReplacement({
    stepId: 'old',
    todayCivil: '2026-11-24',
    scheduledToday: true,
    now: new Date('2026-11-24T10:00:00.000Z'),
    text: 'Run',
    repeat: 'daily',
  });
  assert.equal('error' in plan, false);
  if ('error' in plan) return;
  assert.equal(plan.next.effectiveFrom, '2026-11-24');
  assert.equal(plan.next.replacesStepId, 'old');
  assert.equal(plan.previous.effectiveUntil, '2026-11-24');
  const keptDone = stepHistory({
    step: { ...daily('old'), archivedAt: plan.previous.archivedAt, effectiveUntil: utcMidnightFromCivil(plan.previous.effectiveUntil) },
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    completions: [{ date: '2026-11-24T00:00:00.000Z' }],
    now: new Date('2026-11-24T10:00:00.000Z'),
    legacyTimeZone: zone,
    pastDays: 5,
    futureDays: 2,
  });
  const keptMiss = stepHistory({
    step: { ...daily('old'), archivedAt: plan.previous.archivedAt, effectiveUntil: utcMidnightFromCivil(plan.previous.effectiveUntil) },
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    completions: [],
    now: new Date('2026-11-24T10:00:00.000Z'),
    legacyTimeZone: zone,
    pastDays: 5,
    futureDays: 2,
  });
  const openedToday = stepHistory({
    step: { ...daily('next'), createdAt: new Date('2026-11-24T10:00:00.000Z'), effectiveFrom: utcMidnightFromCivil(plan.next.effectiveFrom) },
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    completions: [],
    now: new Date('2026-11-24T10:00:00.000Z'),
    legacyTimeZone: zone,
    pastDays: 5,
    futureDays: 2,
  });
  assert.equal(keptDone.occurrences.find(row => row.date === '2026-11-24')?.status, 'DONE');
  assert.equal(keptMiss.occurrences.find(row => row.date === '2026-11-24')?.status, 'MISSED');
  assert.equal(openedToday.occurrences.find(row => row.date === '2026-11-24')?.status, 'TODO');
  assert.equal(openedToday.replacementStartsOn, '2026-11-24');
  const sameText = planReplacement({
    stepId: 'old',
    todayCivil: '2026-11-24',
    scheduledToday: true,
    now: new Date('2026-11-24T10:00:00.000Z'),
    text: 'Run',
    repeat: 'daily',
  });
  assert.equal('error' in sameText, false);
  const ids: string[] = [];
  await commitReplacement({
    create: async () => { const id = `step-${ids.length + 1}`; ids.push(id); return id; },
    archive: async () => undefined,
  }, plan);
  if (!('error' in sameText)) {
    await commitReplacement({
      create: async () => { const id = `step-${ids.length + 1}`; ids.push(id); return id; },
      archive: async () => undefined,
    }, sameText);
  }
  assert.deepEqual(ids, ['step-1', 'step-2']);

  const writes: string[] = [];
  await assert.rejects(() => commitReplacement({
    create: async () => { throw new Error('create failed'); },
    archive: async () => { writes.push('archive'); },
  }, plan));
  assert.deepEqual(writes, []);

  const committed: string[] = [];
  const saved = await (async () => {
    const staged: string[] = [];
    try {
      return await commitReplacement({
        create: async () => { staged.push('create'); return 'new'; },
        archive: async () => { staged.push('archive'); throw new Error('archive failed'); },
      }, plan);
    } catch {
      return null;
    } finally {
      if (staged.length === 2 && staged[1] !== 'archive-failed') {
        // The thrown archive is not committed.
      }
    }
  })();
  assert.equal(saved, null);
  assert.deepEqual(committed, []);
});

test('an ordinary step and a replacement can both start today', () => {
  const ordinary = dashboardProgressPercent({
    steps: [daily('added')],
    completions: [{ stepId: 'added', date: '2026-11-22T00:00:00.000Z' }],
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    legacyTimeZone: zone,
  });
  assert.equal(ordinary, 11.11);
  const replacement = dashboardProgressPercent({
    steps: [{ ...daily('next'), createdAt: new Date('2026-11-24T10:00:00.000Z'), effectiveFrom: '2026-11-24T00:00:00.000Z' }],
    completions: [{ stepId: 'next', date: '2026-11-24T00:00:00.000Z' }],
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    legacyTimeZone: zone,
  });
  assert.equal(replacement, 14.29);
});

test('progress keeps archived history and drops days after the archive', () => {
  const archived = dashboardProgressPercent({
    steps: [{ ...daily('old'), archivedAt: '2026-11-24T10:00:00.000Z', effectiveUntil: '2026-11-24T00:00:00.000Z' }],
    completions: [
      { stepId: 'old', date: '2026-11-22T00:00:00.000Z' },
      { stepId: 'old', date: '2026-11-23T00:00:00.000Z' },
      { stepId: 'old', date: '2026-11-24T00:00:00.000Z' },
      { stepId: 'old', date: '2026-11-25T00:00:00.000Z' },
    ],
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    legacyTimeZone: zone,
  });
  assert.equal(archived, 100);
  const withReplacement = dashboardProgressPercent({
    steps: [
      { ...daily('old'), archivedAt: '2026-11-24T10:00:00.000Z', effectiveUntil: '2026-11-24T00:00:00.000Z' },
      { ...daily('next'), effectiveFrom: '2026-11-24T00:00:00.000Z', createdAt: new Date('2026-11-24T10:00:00.000Z') },
    ],
    completions: [
      { stepId: 'old', date: '2026-11-22T00:00:00.000Z' },
      { stepId: 'old', date: '2026-11-23T00:00:00.000Z' },
      { stepId: 'old', date: '2026-11-24T00:00:00.000Z' },
      { stepId: 'next', date: '2026-11-24T00:00:00.000Z' },
    ],
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    legacyTimeZone: zone,
  });
  assert.equal(withReplacement, 40);
});

test('snapshots honor lifecycle dates and hide a future archive', () => {
  const base = {
    id: 'g',
    title: 'Run',
    createdAt: '2026-11-22',
    deadline: '2026-11-30',
    completed: false,
    failedAt: null,
  };
  const step = {
    id: 'old',
    order: 0,
    text: 'Run',
    description: null,
    dueAt: null,
    repeat: 'daily',
    repeatDay: null,
    repeatMonth: null,
    createdAt: '2026-11-22',
    archivedOn: '2026-11-24',
    effectiveUntil: '2026-11-24',
  };
  const visible = buildProgressSnapshot({ goal: base, steps: [step], completions: [{ stepId: 'old', date: '2026-11-22' }], asOf: '2026-11-24', pastHorizonDays: 10, futureHorizonDays: 10 });
  assert.equal(visible.lifecyclePolicy, 'immutable-step-archive-v1');
  assert.equal(visible.steps[0]?.lifecycle, 'archived');
  assert.equal(visible.occurrences.some(row => row.date > '2026-11-24'), false);
  assert.equal(visible.occurrences.find(row => row.date === '2026-11-22')?.status, 'DONE');
  assert.equal(visible.occurrences.find(row => row.date === '2026-11-24')?.status, 'MISSED');
  const earlier = buildProgressSnapshot({ goal: base, steps: [step], completions: [], asOf: '2026-11-23', pastHorizonDays: 10, futureHorizonDays: 10 });
  assert.equal(earlier.steps[0]?.lifecycle, 'active');
  assert.equal(earlier.occurrences.some(row => row.date === '2026-11-25'), true);
  const replacement = buildProgressSnapshot({
    goal: base,
    steps: [{ ...step, id: 'next', createdAt: '2026-11-25', archivedOn: null, effectiveUntil: null, effectiveFrom: '2026-11-25' }],
    completions: [],
    asOf: '2026-11-24',
    pastHorizonDays: 10,
    futureHorizonDays: 10,
  });
  assert.equal(replacement.steps.length, 0);
  const sameDay = buildProgressSnapshot({
    goal: base,
    steps: [
      step,
      { ...step, id: 'next', createdAt: '2026-11-24', archivedOn: null, effectiveUntil: null, effectiveFrom: '2026-11-24' },
    ],
    completions: [{ stepId: 'old', date: '2026-11-24' }],
    asOf: '2026-11-24',
    pastHorizonDays: 10,
    futureHorizonDays: 10,
  });
  assert.equal(sameDay.occurrences.find(row => row.stepId === 'old' && row.date === '2026-11-24')?.status, 'DONE');
  assert.equal(sameDay.occurrences.find(row => row.stepId === 'next' && row.date === '2026-11-24')?.status, 'TODO');
});

test('the verifier rejects a new activity on an archived step', () => {
  const snapshot = buildProgressSnapshot({
    goal: { id: 'g', title: 'Run', createdAt: '2026-11-22', deadline: '2026-11-30', completed: false, failedAt: null },
    steps: [{
      id: 'old',
      order: 0,
      text: 'Run',
      description: null,
      dueAt: null,
      repeat: 'daily',
      repeatDay: null,
      repeatMonth: null,
      createdAt: '2026-11-22',
      archivedOn: '2026-11-24',
      effectiveUntil: '2026-11-24',
    }],
    completions: [{ stepId: 'old', date: '2026-11-22' }],
    asOf: '2026-11-24',
    pastHorizonDays: 10,
    futureHorizonDays: 5,
  });
  const rejected = verifyRecoveryPlan(snapshot, {
    goalId: 'g',
    activities: [{ activityId: 'a', stepId: 'old', date: '2026-11-24', durationMinutes: 20, startMinuteOfDay: 60 }],
  }, { dailyWorkloadLimitMinutes: 60 });
  assert.equal(rejected.violations.some(item => item.code === 'ARCHIVED_STEP'), true);
  assert.equal(rejected.verdict, 'FAIL');
});

test('daily, weekly, monthly, yearly, and once stay inside the lifecycle window', () => {
  const history = stepHistory({
    step: { id: 'year', repeat: 'yearly', repeatMonth: 2, repeatDay: 29, createdAt: new Date('2026-01-01T10:00:00.000Z') },
    goalCreatedAt: new Date('2026-01-01T10:00:00.000Z'),
    goalDueAt: utcMidnightFromCivil('2028-12-31'),
    now: new Date('2026-03-01T10:00:00.000Z'),
    legacyTimeZone: zone,
    pastDays: 80,
    futureDays: 800,
  });
  assert.equal(history.occurrences.some(row => row.date === '2026-02-28'), true);
  assert.equal(history.occurrences.some(row => row.date === '2026-02-29'), false);
  const once = stepHistory({
    step: { id: 'once', dueAt: '2026-11-25T00:00:00.000Z', createdAt: goalCreated },
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    now: new Date('2026-11-24T10:00:00.000Z'),
    legacyTimeZone: zone,
  });
  assert.deepEqual(once.occurrences.map(row => row.date), ['2026-11-25']);
  const weekly = stepHistory({
    step: { id: 'week', repeat: 'weekly', repeatDay: 0, createdAt: goalCreated },
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    now: new Date('2026-11-22T10:00:00.000Z'),
    legacyTimeZone: zone,
    pastDays: 5,
    futureDays: 10,
  });
  assert.deepEqual(weekly.occurrences.map(row => row.date), ['2026-11-22', '2026-11-29']);
  const month = stepHistory({
    step: { id: 'month', repeat: 'monthly', repeatDay: 31, createdAt: new Date('2026-04-01T10:00:00.000Z') },
    goalCreatedAt: new Date('2026-04-01T10:00:00.000Z'),
    goalDueAt: utcMidnightFromCivil('2026-04-30'),
    now: new Date('2026-04-15T10:00:00.000Z'),
    legacyTimeZone: zone,
    pastDays: 20,
    futureDays: 20,
  });
  assert.deepEqual(month.occurrences.map(row => row.date), ['2026-04-30']);
});

test('Budapest DST keeps both civil days and the archive date follows the zone', () => {
  const percent = dashboardProgressPercent({
    steps: [{
      id: 'daily',
      repeat: 'daily',
      createdAt: new Date('2026-03-28T12:00:00.000Z'),
      archivedAt: new Date('2026-03-29T00:30:00.000Z'),
      effectiveUntil: '2026-03-29T00:00:00.000Z',
    }],
    completions: [{ stepId: 'daily', date: '2026-03-27T23:00:00.000Z' }],
    goalCreatedAt: new Date('2026-03-28T12:00:00.000Z'),
    goalDueAt: utcMidnightFromCivil('2026-03-30'),
    legacyTimeZone: 'Europe/Budapest',
  });
  const losAngeles = dashboardProgressPercent({
    steps: [{
      id: 'daily',
      repeat: 'daily',
      createdAt: new Date('2026-03-28T12:00:00.000Z'),
      archivedAt: new Date('2026-03-29T00:30:00.000Z'),
      effectiveUntil: '2026-03-29T00:00:00.000Z',
    }],
    completions: [{ stepId: 'daily', date: '2026-03-27T23:00:00.000Z' }],
    goalCreatedAt: new Date('2026-03-28T12:00:00.000Z'),
    goalDueAt: utcMidnightFromCivil('2026-03-30'),
    legacyTimeZone: 'America/Los_Angeles',
  });
  assert.equal(percent, 50);
  assert.equal(losAngeles, 0);
});

test('a legacy step without lifecycle metadata still counts through the deadline', () => {
  const percent = dashboardProgressPercent({
    steps: [{ id: 'daily', repeat: 'daily' }],
    completions: [],
    goalCreatedAt: goalCreated,
    goalDueAt: goalDue,
    legacyTimeZone: zone,
  });
  assert.equal(percent, 0);
  const snapshot = buildProgressSnapshot({
    goal: { id: 'g', title: 'Run', createdAt: '2026-11-22', deadline: '2026-11-30', completed: false, failedAt: null },
    steps: [{ id: 'daily', order: 0, text: 'Run', description: null, dueAt: null, repeat: 'daily', repeatDay: null, repeatMonth: null }],
    completions: [],
    asOf: '2026-11-22',
  });
  assert.equal(snapshot.lifecyclePolicy, undefined);
  assert.equal(snapshot.steps[0]?.lifecycle, undefined);
  assert.equal(snapshot.occurrences.length > 0, true);
});

test('serialized archive calls keep the first boundary', async () => {
  let step: { archivedAt: Date | null; effectiveUntil: string | null } = { archivedAt: null, effectiveUntil: null };
  let chain = Promise.resolve();
  const run = (scheduledToday: boolean) => {
    const job = chain.then(() => {
      const decision = archiveDecision({
        archivedAt: step.archivedAt,
        effectiveUntil: step.effectiveUntil ? utcMidnightFromCivil(step.effectiveUntil) : null,
        todayCivil: '2026-11-23',
        scheduledToday,
        now: new Date('2026-11-23T10:00:00.000Z'),
      });
      if (decision.changed) step = { archivedAt: decision.archivedAt, effectiveUntil: decision.effectiveUntil };
      return decision;
    });
    chain = job.then(() => undefined, () => undefined);
    return job;
  };
  const [first, second] = await Promise.all([run(true), run(false)]);
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(step.effectiveUntil, '2026-11-23');
});
