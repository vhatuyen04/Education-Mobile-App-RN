export function customGoalCompletionMessage() {
  return 'Goal completed';
}

export function approvedGoalRewardMessage(attempt: { awardedXp?: number | null; awardedPoints?: number | null }) {
  const xp = attempt.awardedXp;
  const points = attempt.awardedPoints;
  if (typeof xp !== 'number' || typeof points !== 'number') return 'SmartGoal: Goal completed.';
  const pointLabel = points === 1 ? 'point' : 'points';
  return `SmartGoal: Goal completed. +${xp} XP. +${points} ${pointLabel}.`;
}
