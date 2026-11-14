import { spawn } from 'child_process';

/** Sparse samples cannot count every repetition. Review must reject when the sample is not enough. */
export const MAX_PROOF_FRAMES = 12;
export const MAX_PROOF_FRAME_BYTES = 4_000_000;

export function parseFfmpegDuration(output: string): number | null {
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds;
}

export function frameSampleTimestamps(durationSeconds: number, maxFrames = MAX_PROOF_FRAMES): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || maxFrames < 1) return [];
  const count = Math.min(maxFrames, Math.max(1, Math.ceil(durationSeconds * 2)));
  const timestamps: number[] = [];
  for (let i = 0; i < count; i += 1) {
    timestamps.push((((i + 0.5) / count) * durationSeconds));
  }
  return timestamps;
}

export function proofSampleFps(durationSeconds: number, maxFrames = MAX_PROOF_FRAMES): number {
  const stamps = frameSampleTimestamps(durationSeconds, maxFrames);
  if (!stamps.length || !(durationSeconds > 0)) return 1;
  return stamps.length / durationSeconds;
}

export function downsampleInOrder<T>(items: T[], keep: number): T[] {
  if (keep < 1 || items.length <= keep) return items.slice();
  if (keep === 1) return [items[0]];
  const picked: T[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < keep; i += 1) {
    const idx = Math.round((i * (items.length - 1)) / (keep - 1));
    if (seen.has(idx)) continue;
    seen.add(idx);
    picked.push(items[idx]);
  }
  return picked;
}

export function limitFramesByBytes<T extends { byteLength: number }>(frames: T[], maxBytes: number): T[] {
  let selected = frames.slice();
  const total = () => selected.reduce((sum, frame) => sum + frame.byteLength, 0);
  while (selected.length > 1 && total() > maxBytes) {
    const nextKeep = Math.max(1, selected.length - 1);
    selected = downsampleInOrder(selected, nextKeep);
  }
  return selected;
}

const REP_WORD = String.raw`(?:push\s*-?\s*ups?|pushups?|sit\s*-?\s*ups?|situps?|squats?|lunges?|burpees?|pull\s*-?\s*ups?|pullups?|reps?|repetitions?)`;

export function requiredRepCount(requirementText: string | null | undefined): number | null {
  const text = String(requirementText ?? '').toLowerCase();
  if (!text.trim()) return null;
  const patterns = [
    new RegExp(String.raw`\b(\d{1,4})\b[^\n]{0,40}\b${REP_WORD}\b`, 'i'),
    new RegExp(String.raw`\b${REP_WORD}\b[^\n]{0,40}\b(\d{1,4})\b`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const raw = match?.[1];
    const count = raw ? Number(raw) : NaN;
    if (Number.isFinite(count) && count > 0) return Math.floor(count);
  }
  return null;
}

export function readVideoDurationSeconds(videoPath: string, ffmpegBin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, ['-hide_banner', '-i', videoPath], { windowsHide: true });
    let output = '';
    child.stderr.on('data', chunk => {
      output += String(chunk);
    });
    child.on('error', reject);
    child.on('close', () => {
      const duration = parseFfmpegDuration(output);
      if (duration == null) reject(new Error('Failed to read video duration'));
      else resolve(duration);
    });
  });
}
