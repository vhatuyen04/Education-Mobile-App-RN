export type AntiFarmGoal = {
  id: string;
  title: string;
  description: string | null;
  rankField: string | null;
  requirementSource: 'USER' | 'AI' | null;
  difficultyScore: number | null;
  pointsAwarded: number | null;
  xpAwarded: number | null;
};

export type AntiFarmRecent = {
  id: string;
  title: string;
  description: string | null;
  difficultyScore: number | null;
};

export type RewardAmounts = { points: number; xp: number };

export class AntiFarmStale extends Error {
  constructor() {
    super('Anti-farm inputs changed');
  }
}

export function antiFarmFingerprint(goal: AntiFarmGoal, recent: AntiFarmRecent[]): string {
  return JSON.stringify({
    id: goal.id,
    title: goal.title,
    description: goal.description ?? '',
    rankField: goal.rankField,
    requirementSource: goal.requirementSource,
    difficultyScore: goal.difficultyScore,
    pointsAwarded: goal.pointsAwarded,
    xpAwarded: goal.xpAwarded,
    recent: recent.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description ?? '',
      difficultyScore: item.difficultyScore,
    })),
  });
}

function baseline(goal: AntiFarmGoal): RewardAmounts | null {
  if (goal.requirementSource !== 'AI') return { points: 0, xp: 0 };
  const looksLikeSmartGoal =
    goal.difficultyScore !== null ||
    typeof goal.pointsAwarded === 'number' ||
    typeof goal.xpAwarded === 'number';
  if (!looksLikeSmartGoal || !goal.rankField) return { points: 0, xp: 0 };
  return {
    points: Math.max(1, Math.floor(Number(goal.pointsAwarded ?? 1))),
    xp: Math.max(0, Math.floor(Number(goal.xpAwarded ?? 0))),
  };
}

function norm(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenSet(value: string) {
  return new Set(norm(value).split(' ').filter(Boolean));
}

function overlap(left: Set<string>, right: Set<string>) {
  let inter = 0;
  for (const token of left) if (right.has(token)) inter += 1;
  const union = left.size + right.size - inter;
  return union ? inter / union : 0;
}

export function heuristicFarm(goal: AntiFarmGoal, recent: AntiFarmRecent[]): boolean {
  const curTokens = tokenSet(goal.title);
  const curDiff = typeof goal.difficultyScore === 'number' ? Number(goal.difficultyScore) : null;
  for (const item of recent) {
    const sim = overlap(curTokens, tokenSet(String(item.title ?? '')));
    if (sim < 0.55) continue;
    const prevDiff = typeof item.difficultyScore === 'number' ? Number(item.difficultyScore) : null;
    if (curDiff !== null && prevDiff !== null && curDiff <= prevDiff) return true;
    if (curDiff === null || prevDiff === null) {
      if (norm(goal.title) === norm(String(item.title ?? ''))) return true;
    }
  }
  return false;
}

export function rewardsForSnapshot(
  goal: AntiFarmGoal,
  recent: AntiFarmRecent[],
  modelFarm: boolean | null,
  mode: 'model' | 'heuristic'
): RewardAmounts {
  const base = baseline(goal);
  if (!base || base.points === 0 && base.xp === 0 && !goal.rankField) return { points: 0, xp: 0 };
  if (!base) return { points: 0, xp: 0 };
  if (!goal.rankField) return { points: 0, xp: 0 };
  if (!recent.length) return base;
  const farm = mode === 'model' ? modelFarm === true : heuristicFarm(goal, recent);
  if (farm) return { points: 0, xp: 0 };
  return base;
}

export function needsFarmModel(goal: AntiFarmGoal, recent: AntiFarmRecent[], hasApiKey: boolean): boolean {
  if (!hasApiKey || !goal.rankField || !recent.length || goal.requirementSource !== 'AI') return false;
  return goal.difficultyScore !== null || typeof goal.pointsAwarded === 'number' || typeof goal.xpAwarded === 'number';
}

export async function settleApprovalRewards<T>(params: {
  maxAttempts: number;
  load: () => Promise<{ goal: AntiFarmGoal; recent: AntiFarmRecent[] } | null>;
  decide: (goal: AntiFarmGoal, recent: AntiFarmRecent[]) => Promise<RewardAmounts>;
  commit: (rewards: RewardAmounts, fingerprint: string | null) => Promise<T>;
}): Promise<T> {
  let lastStale: AntiFarmStale | null = null;
  for (let attempt = 0; attempt < params.maxAttempts; attempt += 1) {
    const loaded = await params.load();
    if (!loaded) {
      try {
        return await params.commit({ points: 0, xp: 0 }, null);
      } catch (error) {
        if (error instanceof AntiFarmStale) {
          lastStale = error;
          continue;
        }
        throw error;
      }
    }
    const rewards = await params.decide(loaded.goal, loaded.recent);
    const fingerprint = antiFarmFingerprint(loaded.goal, loaded.recent);
    try {
      return await params.commit(rewards, fingerprint);
    } catch (error) {
      if (error instanceof AntiFarmStale) {
        lastStale = error;
        continue;
      }
      throw error;
    }
  }
  throw lastStale ?? new AntiFarmStale();
}
