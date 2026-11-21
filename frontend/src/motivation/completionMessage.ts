export function customGoalCompletionMessage() {
  return 'Goal completed';
}

export function goalSuccessMessage(xp: number) {
  const awarded = Math.max(0, Math.floor(xp));
  if (awarded > 0) return `Goal completed. +${awarded} XP.`;
  return 'Goal completed';
}

export function rankingAwardMessage(points: number) {
  const awarded = Math.max(0, Math.floor(points));
  if (awarded > 0) return `Ranking verified. +${awarded} ranking points.`;
  return 'Ranking verified. No additional ranking points.';
}

export function approvedGoalRewardMessage(attempt: { awardedXp?: number | null; awardedPoints?: number | null }) {
  const xp = attempt.awardedXp;
  const points = attempt.awardedPoints;
  if (typeof xp !== 'number' || typeof points !== 'number') return 'SmartGoal: Goal completed.';
  const pointLabel = points === 1 ? 'point' : 'points';
  return `SmartGoal: Goal completed. +${xp} XP. +${points} ${pointLabel}.`;
}
