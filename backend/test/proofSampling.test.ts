import assert from 'node:assert/strict';
import test from 'node:test';

import {
  frameSampleTimestamps,
  limitFramesByBytes,
  parseFfmpegDuration,
  requiredRepCount,
} from '../src/goals/proofSampling.ts';
import { autoReviewFailureWrite, rejectionReason } from '../src/goals/proofFeedback.ts';

test('frame samples cover the end of a long video and stay bounded', () => {
  const duration = 60;
  const stamps = frameSampleTimestamps(duration);
  assert.ok(stamps.length <= 12);
  assert.ok(stamps.length >= 2);
  assert.ok(stamps[0] > 0);
  assert.ok(stamps[stamps.length - 1] > duration * 0.75);
  for (let i = 1; i < stamps.length; i += 1) assert.ok(stamps[i] > stamps[i - 1]);
});

test('a short clip is sampled inside its duration', () => {
  const stamps = frameSampleTimestamps(1.2);
  assert.ok(stamps.length >= 1);
  assert.ok(stamps.every(stamp => stamp > 0 && stamp < 1.2));
});

test('duration text from ffmpeg is parsed', () => {
  assert.equal(parseFfmpegDuration('Duration: 00:01:30.50, start: 0.000000'), 90.5);
  assert.equal(parseFfmpegDuration('no duration'), null);
});

test('repetition counts come only from explicit rep language', () => {
  assert.equal(requiredRepCount('20 push-ups'), 20);
  assert.equal(requiredRepCount('do 15 squats'), 15);
  assert.equal(requiredRepCount('reps: 12'), 12);
  assert.equal(requiredRepCount('run 5 km'), null);
  assert.equal(requiredRepCount('read 30 pages'), null);
  assert.equal(requiredRepCount('chapter 12'), null);
  assert.equal(requiredRepCount('due 2024-11-13'), null);
  assert.equal(requiredRepCount('run 5k'), null);
});

test('frame bytes stay ordered and under the limit', () => {
  const frames = [10, 10, 10, 10].map(byteLength => ({ byteLength, id: byteLength }));
  const limited = limitFramesByBytes(
    frames.map((frame, index) => ({ byteLength: frame.byteLength, id: index })),
    25
  );
  assert.ok(limited.reduce((sum, frame) => sum + frame.byteLength, 0) <= 25);
  const ids = limited.map(frame => frame.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});

test('auto review failure feedback is limited to pending attempts', () => {
  const write = autoReviewFailureWrite('attempt-1', 'network down');
  assert.equal(write.where.status, 'PENDING_REVIEW');
  assert.equal(write.where.id, 'attempt-1');
  let feedback = 'Admin: the video is too dark';
  let status: 'PENDING_REVIEW' | 'REJECTED' = 'REJECTED';
  const changed =
    status === write.where.status
      ? ((feedback = write.data.aiFeedback), 1)
      : 0;
  assert.equal(changed, 0);
  assert.equal(feedback, 'Admin: the video is too dark');
});

test('admin rejection requires a meaningful reason', () => {
  assert.equal(rejectionReason('  ').ok, false);
  assert.equal(rejectionReason('no').ok, false);
  assert.equal(rejectionReason('The video does not show the exercise').ok, true);
});
