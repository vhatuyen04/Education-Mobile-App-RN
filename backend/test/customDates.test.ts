import assert from 'node:assert/strict';
import test from 'node:test';

import { mapStoredGoalToSnapshotInput } from '../src/goals/mapProgressSnapshotRows.ts';
import { buildProgressSnapshot } from '../src/goals/progressSnapshot.ts';
import {
  countCustomDatesBetween,
  dashboardProgressPercent,
  isRealCivilDate,
  isStepScheduledOnCivilDay,
  prepareCustomDates,
  scheduleWriteError,
  stepOutsideActiveRangeError,
  todayOccurrencePercent,
} from '../src/goals/recurrenceSchedule.ts';
import { archiveDecision, completionToggleDecision, planReplacement } from '../src/goals/stepLifecycle.ts';
import { verifyRecoveryPlan } from '../src/goals/verifyRecoveryPlan.ts';

const today = '2026-11-23';
const deadline = '2026-11-30T00:00:00.000Z';
const now = new Date('2026-11-23T10:00:00.000Z');
const goalCreated = new Date('2026-11-01T10:00:00.000Z');

test('custom dates are sorted, unique, and real civil dates', () => {
  assert.equal(scheduleWriteError({ repeat: 'custom', customDates: [] }), 'Select at least one date, and try again.');
  assert.match(scheduleWriteError({ repeat: 'custom', customDates: ['2026-11-23', '2026-11-23'] }) ?? '', /only once/);
  assert.match(scheduleWriteError({ repeat: 'custom', customDates: ['2026-02-31'] }) ?? '', /real calendar date/);
  assert.match(scheduleWriteError({ repeat: 'custom', customDates: ['2026-02-29'] }) ?? '', /real calendar date/);
  assert.equal(isRealCivilDate('2028-02-29'), true);
  assert.equal(isRealCivilDate('2026-11-30'), true);
  assert.equal(isRealCivilDate('2026-12-01'), true);
  const prepared = prepareCustomDates(['2026-12-01', '2026-11-30', '2028-02-29']);
  assert.deepEqual(prepared.ok ? prepared.dates : [], ['2026-11-30', '2026-12-01', '2028-02-29']);
  assert.equal(scheduleWriteError({ repeat: 'daily', customDates: ['2026-11-23'] }), 'A step cannot combine custom dates with another schedule');
  assert.equal(scheduleWriteError({ repeat: 'daily' }), null);
  assert.equal(scheduleWriteError({ dueAt: '2026-11-23T00:00:00.000Z' }), null);
});

test('custom dates must fall from today through the goal deadline', () => {
  const past = stepOutsideActiveRangeError({
    step: { repeat: 'custom', customDates: ['2026-11-22', '2026-11-23'] },
    todayCivil: today,
    goalDueAt: deadline,
  });
  assert.match(past ?? '', /from 2026-11-23 through 2026-11-30/);
  const after = stepOutsideActiveRangeError({
    step: { repeat: 'custom', customDates: ['2026-11-23', '2026-12-01'] },
    todayCivil: today,
    goalDueAt: deadline,
  });
  assert.match(after ?? '', /on or before 2026-11-30/);
  assert.equal(stepOutsideActiveRangeError({
    step: { repeat: 'custom', customDates: ['2026-11-23', '2026-11-30'] },
    todayCivil: today,
    goalDueAt: deadline,
  }), null);
  assert.match(stepOutsideActiveRangeError({
    step: { repeat: 'custom', customDates: ['2026-11-22'] },
    todayCivil: today,
  }) ?? '', /on or after 2026-11-23/);
  assert.equal(stepOutsideActiveRangeError({
    step: { repeat: 'custom', customDates: ['2027-01-15'] },
    todayCivil: today,
  }), null);
});

test('each selected date is one occurrence and an unselected date is none', () => {
  const step = { repeat: 'custom', customDates: ['2026-11-23', '2026-11-30', '2026-12-01'] };
  assert.equal(isStepScheduledOnCivilDay(step, '2026-11-23', 'America/Los_Angeles'), true);
  assert.equal(isStepScheduledOnCivilDay(step, '2026-11-24', 'America/Los_Angeles'), false);
  assert.equal(isStepScheduledOnCivilDay(step, '2026-11-30', 'Europe/Budapest'), true);
  assert.equal(countCustomDatesBetween(step, '2026-11-23', '2026-11-30'), 2);
  const created = new Date('2026-11-01T00:00:00.000Z');
  const due = new Date('2026-11-30T00:00:00.000Z');
  const steps = [
    { id: 'a', ...step, createdAt: created },
    { id: 'b', repeat: 'custom', customDates: ['2026-11-23'], createdAt: created },
  ];
  const percent = dashboardProgressPercent({
    steps,
    completions: [{ stepId: 'a', date: '2026-11-23T00:00:00.000Z' }, { stepId: 'b', date: '2026-11-23T00:00:00.000Z' }, { stepId: 'a', date: '2026-11-24T00:00:00.000Z' }],
    goalCreatedAt: created,
    goalDueAt: due,
    legacyTimeZone: 'America/Los_Angeles',
  });
  assert.equal(percent, 66.67);
  assert.equal(todayOccurrencePercent({
    steps,
    completions: [{ stepId: 'a', date: '2026-11-23T00:00:00.000Z' }],
    goalCreatedAt: created,
    goalDueAt: due,
    civilToday: '2026-11-23',
    legacyTimeZone: 'America/Los_Angeles',
  }), 50);
  const later = { id: 'late', repeat: 'custom', customDates: ['2026-11-23', '2026-11-25'], createdAt: created, effectiveFrom: new Date('2026-11-25T00:00:00.000Z') };
  assert.equal(dashboardProgressPercent({
    steps: [later],
    completions: [
      { stepId: 'late', date: '2026-11-23T00:00:00.000Z' },
      { stepId: 'late', date: '2026-11-25T00:00:00.000Z' },
    ],
    goalCreatedAt: created,
    goalDueAt: due,
  }), 100);
});

test('completion follows today, and only a selected date', () => {
  const step = { repeat: 'custom', customDates: ['2026-11-22', '2026-11-23', '2026-11-24'], createdAt: goalCreated };
  const allowed = completionToggleDecision({
    now,
    authoritativeTimeZone: 'Europe/Budapest',
    requestedDate: '2026-11-23T00:00:00.000Z',
    step,
    goalCreatedAt: goalCreated,
    goalDueAt: deadline,
  });
  assert.equal(allowed.ok, true);
  const undo = completionToggleDecision({
    now,
    authoritativeTimeZone: 'Europe/Budapest',
    requestedDate: '2026-11-23T00:00:00.000Z',
    step,
    goalCreatedAt: goalCreated,
    goalDueAt: deadline,
  });
  assert.equal(undo.ok, true);
  const unselected = completionToggleDecision({
    now,
    authoritativeTimeZone: 'Europe/Budapest',
    requestedDate: '2026-11-23T00:00:00.000Z',
    step: { ...step, customDates: ['2026-11-24'] },
    goalCreatedAt: goalCreated,
    goalDueAt: deadline,
  });
  assert.equal(unselected.ok, false);
  if (!unselected.ok) assert.equal(unselected.error, 'This step is not scheduled today');
  const past = completionToggleDecision({
    now,
    authoritativeTimeZone: 'Europe/Budapest',
    requestedDate: '2026-11-22T00:00:00.000Z',
    step,
    goalCreatedAt: goalCreated,
    goalDueAt: deadline,
  });
  assert.equal(past.ok, false);
  if (!past.ok) assert.equal(past.error, 'Past occurrences are read-only');
  const future = completionToggleDecision({
    now,
    authoritativeTimeZone: 'Europe/Budapest',
    requestedDate: '2026-11-24T00:00:00.000Z',
    step,
    goalCreatedAt: goalCreated,
    goalDueAt: deadline,
  });
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.error, 'Future occurrences are read-only');
});

test('replace and delete keep the selected day that is current', () => {
  const plan = planReplacement({
    stepId: 'old',
    todayCivil: today,
    scheduledToday: true,
    now,
    text: 'Picked days',
    repeat: 'custom',
    customDates: ['2026-11-30', '2026-11-23'],
  });
  assert.ok(!('error' in plan));
  if ('error' in plan) return;
  assert.equal(plan.previous.effectiveUntil, today);
  assert.deepEqual(plan.next.customDates, ['2026-11-23', '2026-11-30']);
  assert.equal(plan.next.effectiveFrom, today);
  const archived = archiveDecision({ archivedAt: null, todayCivil: today, scheduledToday: true, now });
  assert.equal(archived.effectiveUntil, today);
  const idle = archiveDecision({ archivedAt: null, todayCivil: today, scheduledToday: false, now });
  assert.equal(idle.effectiveUntil, '2026-11-22');
});

test('snapshots and the verifier use selected dates only', () => {
  const snapshot = buildProgressSnapshot({
    asOf: '2026-11-24',
    goal: { id: 'goal', title: 'Dates', createdAt: '2026-11-01', deadline: '2026-12-31', completed: false, failedAt: null },
    steps: [
      {
        id: 'picked',
        order: 0,
        text: 'Picked',
        description: null,
        dueAt: null,
        repeat: 'custom',
        repeatDay: null,
        repeatMonth: null,
        customDates: ['2026-11-23', '2026-11-24', '2026-11-30', '2028-02-29'],
        createdAt: '2026-11-01',
      },
      {
        id: 'daily',
        order: 1,
        text: 'Daily',
        description: null,
        dueAt: null,
        repeat: 'daily',
        repeatDay: null,
        repeatMonth: null,
        createdAt: '2026-11-24',
      },
    ],
    completions: [{ stepId: 'picked', date: '2026-11-23' }, { stepId: 'picked', date: '2026-11-25' }],
  });
  const picked = snapshot.occurrences.filter(item => item.stepId === 'picked').map(item => `${item.date}:${item.status}`);
  assert.deepEqual(picked, ['2026-11-23:DONE', '2026-11-24:TODO', '2026-11-30:FUTURE']);
  assert.equal(snapshot.occurrences.some(item => item.stepId === 'picked' && item.date === '2026-11-25'), false);
  assert.equal(snapshot.occurrences.some(item => item.stepId === 'picked' && item.date === '2028-02-29'), false);
  assert.equal(snapshot.unscheduledCompletions.some(item => item.stepId === 'picked' && item.date === '2026-11-25'), true);
  assert.equal(snapshot.occurrences.some(item => item.stepId === 'daily' && item.date === '2026-11-24'), true);
  assert.equal(snapshot.steps.find(step => step.id === 'picked')?.schedule.type, 'custom');
  assert.equal(snapshot.steps.find(step => step.id === 'daily')?.schedule.type, 'repeat');

  const archived = buildProgressSnapshot({
    asOf: '2026-11-24',
    goal: { id: 'goal', title: 'Dates', createdAt: '2026-11-01', deadline: '2026-12-31', completed: false, failedAt: null },
    steps: [{
      id: 'old',
      order: 0,
      text: 'Old',
      description: null,
      dueAt: null,
      repeat: 'custom',
      repeatDay: null,
      repeatMonth: null,
      customDates: ['2026-11-23', '2026-11-24', '2026-11-30'],
      createdAt: '2026-11-01',
      effectiveFrom: '2026-11-01',
      effectiveUntil: '2026-11-24',
      archivedOn: '2026-11-24',
    }],
    completions: [{ stepId: 'old', date: '2026-11-23' }],
  });
  assert.deepEqual(archived.occurrences.map(item => `${item.date}:${item.status}`), ['2026-11-23:DONE', '2026-11-24:MISSED']);

  const onDate = verifyRecoveryPlan(snapshot, {
    goalId: 'goal',
    activities: [
      { activityId: 'kept', stepId: 'picked', date: '2026-11-23', durationMinutes: 20, startMinuteOfDay: 540 },
      { activityId: 'a', stepId: 'picked', date: '2026-11-30', durationMinutes: 20, startMinuteOfDay: 600 },
    ],
  }, { dailyWorkloadLimitMinutes: 60 });
  assert.equal(onDate.verdict, 'PASS');
  assert.equal(onDate.checks.find(check => check.code === 'SCHEDULE_KNOWN')?.status, 'PASS');
  const moved = verifyRecoveryPlan(snapshot, {
    goalId: 'goal',
    activities: [
      { activityId: 'kept-miss', stepId: 'picked', date: '2026-11-23', durationMinutes: 20, startMinuteOfDay: 540 },
      { activityId: 'b', stepId: 'picked', date: '2026-11-25', durationMinutes: 20, startMinuteOfDay: 600 },
    ],
  }, { dailyWorkloadLimitMinutes: 60 });
  assert.equal(moved.verdict, 'PASS');
  assert.equal(snapshot.occurrences.some(item => item.stepId === 'picked' && item.date === '2026-11-25'), false);
  const archivedPlan = verifyRecoveryPlan(archived, {
    goalId: 'goal',
    activities: [{ activityId: 'c', stepId: 'old', date: '2026-11-30', durationMinutes: 20, startMinuteOfDay: 600 }],
  }, { dailyWorkloadLimitMinutes: 60 });
  assert.ok(archivedPlan.violations.some(item => item.code === 'ARCHIVED_STEP'));

  const mapped = mapStoredGoalToSnapshotInput({
    goal: { id: 'goal', title: 'Dates', createdAt: new Date('2026-11-01T10:00:00.000Z'), dueAt: new Date('2026-11-30T00:00:00.000Z'), completed: false, failedAt: null },
    steps: [{
      id: 'picked',
      order: 0,
      text: 'Picked',
      description: null,
      dueAt: null,
      repeat: 'custom',
      repeatDay: null,
      repeatMonth: null,
      customDates: ['2026-11-23', '2026-11-30'],
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
    }],
    completions: [],
    timeZone: 'Europe/Budapest',
  });
  assert.deepEqual(mapped.steps[0]?.customDates, ['2026-11-23', '2026-11-30']);
});
