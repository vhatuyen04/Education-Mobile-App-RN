import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STORED_TIMESTAMP_LIMITATION,
  civilDateInTimeZone,
  mapStoredGoalToSnapshotInput,
  type StoredCompletionRow,
  type StoredGoalRow,
  type StoredStepRow,
} from '../src/goals/mapProgressSnapshotRows.ts';
import { buildProgressSnapshot } from '../src/goals/progressSnapshot.ts';

function at(iso: string): Date {
  return new Date(iso);
}

test('UTC midnight stays on that civil date only in UTC', () => {
  const instant = at('2026-11-19T00:00:00.000Z');
  assert.equal(civilDateInTimeZone(instant, 'UTC'), '2026-11-19');
  assert.equal(civilDateInTimeZone(instant, 'Europe/Budapest'), '2026-11-19');
});

test('a Budapest local midnight is the previous UTC date', () => {
  const instant = at('2026-11-18T23:00:00.000Z');
  assert.equal(civilDateInTimeZone(instant, 'Europe/Budapest'), '2026-11-19');
  assert.equal(civilDateInTimeZone(instant, 'UTC'), '2026-11-18');
});

test('positive and negative offsets can cross a calendar date', () => {
  assert.equal(civilDateInTimeZone(at('2026-11-19T15:00:00.000Z'), 'Asia/Tokyo'), '2026-11-20');
  assert.equal(civilDateInTimeZone(at('2026-11-19T15:00:00.000Z'), 'UTC'), '2026-11-19');
  assert.equal(civilDateInTimeZone(at('2026-11-19T03:30:00.000Z'), 'America/New_York'), '2026-11-18');
  assert.equal(civilDateInTimeZone(at('2026-11-19T03:30:00.000Z'), 'UTC'), '2026-11-19');
});

test('daylight-saving midnights use the zone rules, not the host zone', () => {
  assert.equal(civilDateInTimeZone(at('2026-03-28T23:00:00.000Z'), 'Europe/Budapest'), '2026-03-29');
  assert.equal(civilDateInTimeZone(at('2026-10-24T22:00:00.000Z'), 'Europe/Budapest'), '2026-10-25');
  assert.equal(civilDateInTimeZone(at('2026-10-24T22:00:00.000Z'), 'UTC'), '2026-10-24');
});

test('an unknown time zone is rejected', () => {
  assert.throws(() => civilDateInTimeZone(at('2026-11-19T00:00:00.000Z'), 'Not/AZone'), RangeError);
  assert.throws(() => civilDateInTimeZone(new Date(Number.NaN), 'UTC'), RangeError);
});

test('stored rows become the regression snapshot only in the write-time zone', () => {
  const goal: StoredGoalRow = {
    id: 'goal-1',
    title: 'Practice guitar',
    createdAt: at('2026-11-16T23:00:00.000Z'),
    dueAt: at('2026-11-27T23:00:00.000Z'),
    completed: false,
    failedAt: null,
  };
  const steps: StoredStepRow[] = [
    {
      id: 'step-scales',
      order: 0,
      text: 'Play scales',
      description: null,
      dueAt: null,
      repeat: 'daily',
      repeatDay: null,
      repeatMonth: null,
    },
    {
      id: 'step-song',
      order: 1,
      text: 'Record one song',
      description: null,
      dueAt: at('2026-11-26T23:00:00.000Z'),
      repeat: null,
      repeatDay: null,
      repeatMonth: null,
    },
  ];
  const completions: StoredCompletionRow[] = [{ stepId: 'step-scales', date: at('2026-11-18T23:00:00.000Z') }];

  const budapest = mapStoredGoalToSnapshotInput({ goal, steps, completions, timeZone: 'Europe/Budapest' });
  assert.equal(budapest.goal.createdAt, '2026-11-17');
  assert.equal(budapest.goal.deadline, '2026-11-28');
  assert.equal(budapest.steps[1]?.dueAt, '2026-11-27');
  assert.equal(budapest.completions[0]?.date, '2026-11-19');
  const snapshot = buildProgressSnapshot({ ...budapest, asOf: '2026-11-21' });
  assert.deepEqual(snapshot.summary, { done: 1, missed: 3, todo: 1, future: 8, total: 13 });

  const utc = mapStoredGoalToSnapshotInput({ goal, steps, completions, timeZone: 'UTC' });
  assert.equal(utc.completions[0]?.date, '2026-11-18');
  assert.notEqual(utc.goal.createdAt, budapest.goal.createdAt);
  assert.match(STORED_TIMESTAMP_LIMITATION, /no stored time zone/i);
});
