export function rewardsForDifficultyScore(score: number): { pointsAwarded: number; xpAwarded: number } {
  const clamped = Math.max(1, Math.min(100, Math.floor(score)));
  const pointsAwarded = Math.max(1, Math.round(Math.pow(clamped, 1.2)));
  return { pointsAwarded, xpAwarded: Math.max(0, pointsAwarded) };
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
