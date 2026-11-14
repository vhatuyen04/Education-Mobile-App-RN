export function rewardsForDifficultyScore(score: number): { pointsAwarded: number; xpAwarded: number } {
  const clamped = Math.max(1, Math.min(100, Math.floor(score)));
  const pointsAwarded = Math.max(1, Math.round(Math.pow(clamped, 1.2)));
  return { pointsAwarded, xpAwarded: Math.max(0, pointsAwarded) };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OPEN_DEADLINE_DAYS = 365;

export function deadlineWindowDays(deadline: Date | null, now: Date): number {
  if (!deadline || Number.isNaN(deadline.getTime())) return OPEN_DEADLINE_DAYS;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const due = Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth(), deadline.getUTCDate());
  const days = Math.round((due - today) / MS_PER_DAY);
  return Math.max(1, Math.min(OPEN_DEADLINE_DAYS, days));
}

export function scaleDifficultyScore(score: number, fromDeadline: Date | null, toDeadline: Date | null, now: Date): number {
  const base = Math.max(1, Math.min(100, Math.floor(score)));
  const fromDays = deadlineWindowDays(fromDeadline, now);
  const toDays = deadlineWindowDays(toDeadline, now);
  if (toDays <= fromDays) return base;
  const scaled = Math.round(base * fromDays / toDays);
  return Math.max(1, Math.min(base, scaled));
}

export function rewardsAfterDeadlineChange(input: {
  difficultyScore: number;
  pointsAwarded: number;
  xpAwarded: number;
  fromDeadline: Date | null;
  toDeadline: Date | null;
  now?: Date;
}): { difficultyScore: number; pointsAwarded: number; xpAwarded: number } {
  const now = input.now ?? new Date();
  const difficultyScore = scaleDifficultyScore(input.difficultyScore, input.fromDeadline, input.toDeadline, now);
  if (difficultyScore >= input.difficultyScore) {
    return {
      difficultyScore: input.difficultyScore,
      pointsAwarded: input.pointsAwarded,
      xpAwarded: input.xpAwarded,
    };
  }
  if (input.pointsAwarded === 0 && input.xpAwarded === 0) {
    return { difficultyScore, pointsAwarded: 0, xpAwarded: 0 };
  }
  return { difficultyScore, ...rewardsForDifficultyScore(difficultyScore) };
}

export function dateFromYmd(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

export function classifyCreatedGoal(
  trusted: {
    difficultyScore: number;
    difficultyConfidence: number;
    difficultyReason: string;
    pointsAwarded: number;
    xpAwarded: number;
  } | null
) {
  if (!trusted) {
    return {
      requirementSource: 'USER' as const,
      difficultyScore: null,
      difficultyConfidence: null,
      difficultyReason: null,
      pointsAwarded: 0,
      xpAwarded: 0,
      requiresProof: false,
    };
  }
  return {
    requirementSource: 'AI' as const,
    difficultyScore: trusted.difficultyScore,
    difficultyConfidence: trusted.difficultyConfidence,
    difficultyReason: trusted.difficultyReason,
    pointsAwarded: trusted.pointsAwarded,
    xpAwarded: trusted.xpAwarded,
    requiresProof: true,
  };
}
