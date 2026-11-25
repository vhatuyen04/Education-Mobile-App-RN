import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendationScheduleDrafts, recommendationStepFields } from '../src/ai/recommendationSchedules.ts';
import { draftFromScheduleText, scheduleRange, scheduleTextFromDraft, toggleDate } from '../src/utils/schedulePicker.ts';

const now = new Date(2026, 10, 24, 12);
const deadline = '2026-11-30';

test('a valid Once recommendation retains its date', () => {
  const [step] = recommendationScheduleDrafts([{ scheduleText: 'once:2026-11-26' }], deadline, now);
  assert.equal(step.scheduleText, 'once:2026-11-26');
  assert.equal(step.scheduleError, null);
});

for (const dates of [['2026-11-22'], ['2026-12-01'], ['2026-11-22', '2026-12-01']]) {
  test(`preserves and flags invalid recommendation dates ${dates.join(', ')}`, () => {
    const original = dates.map(due => ({ scheduleText: `once:${due}` }));
    const drafts = recommendationScheduleDrafts(original, deadline, now);
    assert.deepEqual(drafts.map(draft => draft.scheduleText), original.map(step => step.scheduleText));
    for (const draft of drafts) assert.match(draft.scheduleError ?? '', /today|deadline/);
  });
}

test('a correction from the existing picker passes the acceptance gate with exactly the confirmed date', () => {
  const range = scheduleRange(deadline, '2026-11-24');
  const original = 'once:2026-11-22';
  assert.ok(recommendationScheduleDrafts([{ scheduleText: original }], deadline, now)[0].scheduleError);
  const corrected = toggleDate(draftFromScheduleText(original), '2026-11-28', range);
  const confirmed = scheduleTextFromDraft(corrected, range);
  assert.deepEqual(confirmed, { text: 'once:2026-11-28' });
  assert.ok('text' in confirmed);
  assert.deepEqual(recommendationScheduleDrafts([{ scheduleText: confirmed.text }], deadline, now), [
    { scheduleText: 'once:2026-11-28', scheduleError: null },
  ]);
  assert.deepEqual(recommendationStepFields({ type: 'once', due: confirmed.text.slice(5) }), {
    dueAt: '2026-11-28T00:00:00.000Z',
  });
});
