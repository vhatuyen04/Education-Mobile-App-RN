import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTENT_MODERATION_SYSTEM,
  moderationFailure,
  moderationUpdateForStatus,
  parseModerationResponse,
  releasedProofUrl,
  requestContentModeration,
  SAMPLED_FRAME_LIMITATION,
} from '../src/goals/contentModeration.ts';

test('moderation parses clear and flagged results and treats every other result as clear', () => {
  assert.equal(parseModerationResponse('{"verdict":"CLEAR","note":"Looks safe"}').verdict, 'CLEAR');
  assert.equal(parseModerationResponse('{"verdict":"FLAGGED","note":"Graphic violence"}').verdict, 'FLAGGED');
  assert.equal(parseModerationResponse('{"verdict":"UNCERTAIN","note":"Too dark"}').verdict, 'CLEAR');
  assert.equal(parseModerationResponse('{"decision":"APPROVE"}').verdict, 'CLEAR');
  assert.equal(parseModerationResponse('not json').verdict, 'CLEAR');
  assert.equal(moderationFailure('network down').verdict, 'CLEAR');
  assert.match(parseModerationResponse('{"verdict":"CLEAR","note":"ok"}').note, /cannot guarantee the entire video is safe/);
});

test('a moderation request failure stays clear', async () => {
  const thrown = await requestContentModeration({
    apiKey: 'test-key',
    description: 'Recorded race result',
    frames: [Buffer.from('frame')],
    fetchImpl: async () => {
      throw new Error('socket closed');
    },
  });
  assert.equal(thrown.verdict, 'CLEAR');

  const failed = await requestContentModeration({
    apiKey: 'test-key',
    description: 'Recorded race result',
    frames: [Buffer.from('frame')],
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'unavailable' } }), { status: 503 }),
  });
  assert.equal(failed.verdict, 'CLEAR');
  assert.equal(requestContentModeration({ apiKey: '', description: 'x', frames: [Buffer.from('frame')] }) instanceof Promise, true);
  const unconfigured = await requestContentModeration({ apiKey: '', description: 'x', frames: [Buffer.from('frame')] });
  assert.equal(unconfigured.verdict, 'CLEAR');
});

test('clear moderation queues review, and a finalized proof is not rewritten', () => {
  const now = new Date('2026-11-17T00:00:00.000Z');
  const queued = moderationUpdateForStatus('PENDING_UPLOAD', { verdict: 'CLEAR', note: 'safe' }, now);
  assert.equal(queued?.status, 'PENDING_REVIEW');
  assert.equal(queued?.moderationStatus, 'CLEAR');
  assert.equal(moderationUpdateForStatus('APPROVED', { verdict: 'FLAGGED', note: 'late' }, now), null);
  assert.equal(moderationUpdateForStatus('REJECTED', { verdict: 'CLEAR', note: 'late' }, now), null);
  assert.equal(releasedProofUrl('PENDING_REVIEW', 'https://example.test/video.mp4'), null);
  assert.equal(releasedProofUrl('APPROVED', 'https://example.test/video.mp4'), 'https://example.test/video.mp4');
  assert.match(CONTENT_MODERATION_SYSTEM, /do not verify achievements/i);
  assert.doesNotMatch(CONTENT_MODERATION_SYSTEM, /"decision":"APPROVE"/);
  assert.match(SAMPLED_FRAME_LIMITATION, /cannot guarantee the entire video is safe/);
});
