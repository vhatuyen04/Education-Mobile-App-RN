import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyDate, monthDays, pageOccurrences, shiftMonth, type OccurrenceWindow, type ScheduleStep } from '../src/utils/stepOccurrences.ts';

const today = '2026-11-24';

function window(extra: Partial<OccurrenceWindow> = {}): OccurrenceWindow {
  return {
    start: '2026-11-22',
    end: '2026-11-30',
    today,
    archived: false,
    done: new Set<string>(),
    ...extra,
  };
}

test('a visible month marks only scheduled daily days', () => {
  const step: ScheduleStep = { repeat: 'daily' };
  const bounds = window({ done: new Set(['2026-11-22']) });
  const days = monthDays(step, bounds, 2026, 11);
  assert.equal(days.find(day => day.date === '2026-11-21')?.status, null);
  assert.equal(days.find(day => day.date === '2026-11-22')?.status, 'DONE');
  assert.equal(days.find(day => day.date === '2026-11-23')?.status, 'MISSED');
  assert.equal(days.find(day => day.date === '2026-11-24')?.status, 'TODO');
  assert.equal(days.find(day => day.date === '2026-11-25')?.status, 'FUTURE');
  assert.equal(days.find(day => day.date === '2026-12-01')?.status, undefined);
  assert.equal(classifyDate(step, bounds, '2026-11-21'), null);
});

test('weekly, once, archived, and replacement days stay inside their own bounds', () => {
  const weekly = monthDays({ repeat: 'weekly', repeatDay: 1 }, window(), 2026, 11)
    .filter(day => day.status)
    .map(day => day.date);
  assert.deepEqual(weekly, ['2026-11-23', '2026-11-30']);

  const once = monthDays({ dueAt: '2026-11-23T00:00:00.000Z' }, window(), 2026, 11).filter(day => day.status);
  assert.deepEqual(once.map(day => day.date), ['2026-11-23']);
  assert.equal(once[0]?.status, 'MISSED');

  const archived = window({ end: '2026-11-24', archived: true });
  assert.equal(classifyDate({ repeat: 'daily' }, archived, '2026-11-24'), 'MISSED');
  assert.equal(classifyDate({ repeat: 'daily' }, archived, '2026-11-25'), null);
  assert.equal(classifyDate({ repeat: 'daily' }, { ...archived, done: new Set(['2026-11-24']) }, '2026-11-24'), 'DONE');

  const replacement = window({ start: '2026-11-25' });
  assert.equal(classifyDate({ repeat: 'daily' }, replacement, '2026-11-24'), null);
  assert.equal(classifyDate({ repeat: 'daily' }, replacement, '2026-11-25'), 'FUTURE');
});

test('monthly and yearly dates clamp without inventing a day', () => {
  const april = monthDays({ repeat: 'monthly', repeatDay: 31 }, window({ start: '2026-04-01', end: '2026-04-30', today: '2026-04-15' }), 2026, 4);
  assert.equal(april.find(day => day.date === '2026-04-30')?.status, 'FUTURE');
  assert.equal(april.some(day => day.date === '2026-04-31'), false);
  const february = classifyDate(
    { repeat: 'yearly', repeatMonth: 2, repeatDay: 29 },
    window({ start: '2026-01-01', end: '2026-12-31', today: '2026-03-01' }),
    '2026-02-28'
  );
  assert.equal(february, 'MISSED');
  assert.equal(classifyDate(
    { repeat: 'yearly', repeatMonth: 2, repeatDay: 29 },
    window({ start: '2026-01-01', end: '2026-12-31', today: '2026-03-01' }),
    '2026-02-29'
  ), null);
});

test('history and upcoming pages stay short and do not share dates', () => {
  const step: ScheduleStep = { repeat: 'daily' };
  const bounds = window({ start: '2020-01-01', end: null, done: new Set(['2026-11-22']) });
  const history = pageOccurrences({ step, window: bounds, direction: 'history', limit: 5 });
  assert.deepEqual(history.items.map(item => item.date), ['2026-11-23', '2026-11-22', '2026-11-21', '2026-11-20', '2026-11-19']);
  assert.equal(history.items[1]?.status, 'DONE');
  assert.equal(history.items[0]?.status, 'MISSED');
  assert.equal(history.hasMore, true);
  const older = pageOccurrences({ step, window: bounds, direction: 'history', limit: 2, cursor: history.items[4]?.date });
  assert.deepEqual(older.items.map(item => item.date), ['2026-11-18', '2026-11-17']);

  const upcoming = pageOccurrences({ step, window: bounds, direction: 'upcoming', limit: 5 });
  assert.deepEqual(upcoming.items.map(item => item.date), ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
  assert.equal(upcoming.items.every(item => item.status === 'FUTURE'), true);
  assert.equal(upcoming.hasMore, true);
  const later = pageOccurrences({ step, window: bounds, direction: 'upcoming', limit: 1, cursor: '2026-11-29' });
  assert.deepEqual(later.items.map(item => item.date), ['2026-11-30']);

  const archived = pageOccurrences({ step, window: window({ end: '2026-11-24', archived: true }), direction: 'upcoming', limit: 5 });
  assert.deepEqual(archived.items, []);
  assert.equal(shiftMonth(2026, 12, 1).year, 2027);
  assert.equal(shiftMonth(2026, 12, 1).month, 1);
});

test('a utc-midnight once date keeps its civil day and a legacy instant uses the device day', () => {
  const bounds = window({ start: '2026-11-01', end: '2026-11-30', today: '2026-11-23' });
  assert.equal(classifyDate({ dueAt: '2026-11-23T00:00:00.000Z' }, bounds, '2026-11-23'), 'TODO');
  assert.equal(classifyDate({ dueAt: '2026-11-23T00:00:00.000Z' }, bounds, '2026-11-22'), null);
  const legacy = new Date('2026-11-15T22:59:59.999Z');
  const month = String(legacy.getMonth() + 1).padStart(2, '0');
  const day = String(legacy.getDate()).padStart(2, '0');
  const localDay = `${legacy.getFullYear()}-${month}-${day}`;
  const legacyStatus = localDay < '2026-11-23' ? 'MISSED' : localDay > '2026-11-23' ? 'FUTURE' : 'TODO';
  assert.equal(classifyDate({ dueAt: '2026-11-15T22:59:59.999Z' }, bounds, localDay), legacyStatus);
  assert.equal(classifyDate({ dueAt: '2026-11-15T22:59:59.999Z' }, bounds, '2026-11-01'), localDay === '2026-11-01' ? legacyStatus : null);
});

test('view all pages walk a long daily history without dropping a day', () => {
  const step: ScheduleStep = { repeat: 'daily' };
  const bounds = window({ start: '2025-01-01', end: '2026-02-04', today: '2026-02-04', done: new Set(['2025-06-01']) });
  let cursor: string | null = null;
  const seen: string[] = [];
  for (let page = 0; page < 20; page += 1) {
    const next = pageOccurrences({ step, window: bounds, direction: 'history', limit: 40, cursor });
    seen.push(...next.items.map(item => item.date));
    if (!next.hasMore) break;
    cursor = next.items[next.items.length - 1]?.date ?? null;
  }
  assert.equal(seen.length, 399);
  assert.equal(seen[0], '2026-02-03');
  assert.equal(seen[seen.length - 1], '2025-01-01');
  assert.equal(seen.filter(date => date === '2025-06-01').length, 1);
  assert.equal(new Set(seen).size, seen.length);
});
