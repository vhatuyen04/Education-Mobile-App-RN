import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGeneratedSuggestion, readGeneratedStepSchedule } from '../src/goals/aiSuggestion.ts';
import { scheduleWriteError } from '../src/goals/recurrenceSchedule.ts';

function suggestion(steps: unknown[]) {
  return {
    ok: true,
    suggestion: {
      title: 'Study Java',
      field: 'Academy',
      deadline: '2026-12-31',
      difficultyScore: 20,
      difficultyConfidence: 0.5,
      difficultyReason: 'A normal study habit.',
      rankingEligible: false,
      rankingEligibilityReason: 'Ordinary study.',
      steps,
    },
  };
}

function step(schedule: unknown, text = 'Study Java') {
  return { text, description: 'Read one chapter.', schedule };
}

function scheduleOf(value: unknown) {
  const parsed = parseGeneratedSuggestion(value);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || !parsed.value.ok) return null;
  return parsed.value.suggestion.steps[0]?.schedule ?? null;
}

test('valid daily, weekly, monthly, yearly, once, and no schedule pass', () => {
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat', repeat: 'daily' })])), { type: 'repeat', repeat: 'daily' });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat', repeat: 'weekly', repeatDay: 1 })])), {
    type: 'repeat',
    repeat: 'weekly',
    repeatDay: 1,
  });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat', repeat: 'monthly', repeatDay: 31 })])), {
    type: 'repeat',
    repeat: 'monthly',
    repeatDay: 31,
  });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat', repeat: 'yearly', repeatMonth: 2, repeatDay: 29 })])), {
    type: 'repeat',
    repeat: 'yearly',
    repeatMonth: 2,
    repeatDay: 29,
  });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'once', due: '2028-02-29' })])), { type: 'once', due: '2028-02-29' });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'none' })])), { type: 'none' });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'daily' })])), { type: 'repeat', repeat: 'daily' });
  assert.deepEqual(scheduleOf(suggestion([step('day')])), { type: 'repeat', repeat: 'daily' });
});

test('a missing repeat stays daily, and a missing weekday stays missing', () => {
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat' })])), { type: 'repeat', repeat: 'daily' });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat', repeat: '   ' })])), { type: 'repeat', repeat: 'daily' });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat', repeat: 'weekly' })])), { type: 'repeat', repeat: 'weekly' });
});

test('an unknown recurrence is rejected for goal generation and is not stored as daily', () => {
  const generated = parseGeneratedSuggestion(suggestion([step({ type: 'repeat', repeat: 'every-other-day' })]));
  assert.equal(generated.ok, false);
  if (!generated.ok) {
    assert.match(generated.error, /every-other-day/);
    assert.equal(generated.error.includes('daily'), true);
    assert.equal(JSON.stringify(generated).includes('"repeat":"daily"'), false);
  }
  assert.equal(readGeneratedStepSchedule({ type: 'repeat', repeat: 'every-other-day' }).ok, false);
  const aliased = parseGeneratedSuggestion(suggestion([step({ type: 'daily', repeat: 'every-other-day' })]));
  assert.equal(aliased.ok, false);
  if (!aliased.ok) assert.match(aliased.error, /every-other-day/);
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'daily', repeat: 'daily' })])), { type: 'repeat', repeat: 'daily' });
});

test('invalid weekday, month day, yearly date, and one-time date are rejected', () => {
  const weekday = parseGeneratedSuggestion(suggestion([step({ type: 'repeat', repeat: 'weekly', repeatDay: 7 })]));
  const namedDay = parseGeneratedSuggestion(suggestion([step({ type: 'repeat', repeat: 'weekly', repeatDay: 'Mon' })]));
  const month = parseGeneratedSuggestion(suggestion([step({ type: 'repeat', repeat: 'monthly', repeatDay: 32 })]));
  const year = parseGeneratedSuggestion(suggestion([step({ type: 'repeat', repeat: 'yearly', repeatMonth: 2, repeatDay: 30 })]));
  const partialYear = parseGeneratedSuggestion(suggestion([step({ type: 'repeat', repeat: 'yearly', repeatMonth: 2 })]));
  const once = parseGeneratedSuggestion(suggestion([step({ type: 'once', due: '2026-02-29' })]));
  for (const result of [weekday, namedDay, month, year, partialYear, once]) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(JSON.stringify(result).includes('"repeat":"daily"'), false);
  }
  assert.match(weekday.ok ? '' : weekday.error, /weekday/i);
  assert.match(once.ok ? '' : once.error, /2026-02-29/);
});

test('recommendation acceptance uses the same rejection and cannot persist the raw repeat as daily', () => {
  const recommendation = suggestion([step({ type: 'repeat', repeat: 'every-other-day' }, 'Practice')]);
  const parsed = parseGeneratedSuggestion(recommendation);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.error, /Practice/);
  const writeError = scheduleWriteError({ repeat: 'every-other-day', repeatDay: null, repeatMonth: null, dueAt: null });
  assert.equal(typeof writeError, 'string');
  assert.notEqual(writeError, null);
});
