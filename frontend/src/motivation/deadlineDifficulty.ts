const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OPEN_DEADLINE_DAYS = 365;

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function windowDays(deadline: Date | null, now: Date): number {
  if (!deadline || Number.isNaN(deadline.getTime())) return OPEN_DEADLINE_DAYS;
  const days = Math.round((utcDay(deadline) - utcDay(now)) / MS_PER_DAY);
  return Math.max(1, Math.min(OPEN_DEADLINE_DAYS, days));
}

function dateFromYmd(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function rewardsForScore(score: number): { points: number; xp: number } {
  const clamped = Math.max(1, Math.min(100, Math.floor(score)));
  const points = Math.max(1, Math.round(Math.pow(clamped, 1.2)));
  return { points, xp: Math.max(0, points) };
}

export function previewRewardsForDeadline(input: {
  difficultyScore: number;
  pointsAwarded: number;
  xpAwarded: number;
  suggestedDeadline: string;
  chosenDeadline: string;
  now?: Date;
}): { difficultyScore: number; pointsAwarded: number; xpAwarded: number } {
  const now = input.now ?? new Date();
  const from = dateFromYmd(input.suggestedDeadline);
  const to = dateFromYmd(input.chosenDeadline);
  if (!from) {
    return {
      difficultyScore: input.difficultyScore,
      pointsAwarded: input.pointsAwarded,
      xpAwarded: input.xpAwarded,
    };
  }
  const base = Math.max(1, Math.min(100, Math.floor(input.difficultyScore)));
  const fromDays = windowDays(from, now);
  const toDays = windowDays(to, now);
  const score = toDays <= fromDays ? base : Math.max(1, Math.min(base, Math.round(base * fromDays / toDays)));
  if (score >= input.difficultyScore) {
    return {
      difficultyScore: input.difficultyScore,
      pointsAwarded: input.pointsAwarded,
      xpAwarded: input.xpAwarded,
    };
  }
  if (input.pointsAwarded === 0 && input.xpAwarded === 0) {
    return { difficultyScore: score, pointsAwarded: 0, xpAwarded: 0 };
  }
  const rewards = rewardsForScore(score);
  return { difficultyScore: score, pointsAwarded: rewards.points, xpAwarded: rewards.xp };
}
