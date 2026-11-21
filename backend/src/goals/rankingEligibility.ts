export const RANKING_ELIGIBILITY_MIN_SCORE = 70;

export function resolveRankingEligibility(input: {
  modelEligible: boolean;
  difficultyScore: number;
  reason: string;
}): { rankingEligible: boolean; rankingEligibilityReason: string } {
  const reason = String(input.reason ?? '').trim();
  if (!input.modelEligible || input.difficultyScore < RANKING_ELIGIBILITY_MIN_SCORE) {
    const extra = input.modelEligible ? ' Not unusual enough for ranking.' : '';
    return { rankingEligible: false, rankingEligibilityReason: `${reason}${extra}`.trim() || 'Ordinary goal' };
  }
  return { rankingEligible: true, rankingEligibilityReason: reason || 'Unusually impressive measurable achievement' };
}

export function rankingSubmissionDenial(goal: {
  completed: boolean;
  failedAt: Date | string | null;
  requirementSource: string | null;
  rankingEligible: boolean | null;
  rankingSettled: boolean;
}): { status: 403 | 409; error: string } | null {
  if (goal.failedAt) return { status: 409, error: 'Goal can no longer be edited' };
  if (!goal.completed) return { status: 409, error: 'Goal must be completed before ranking proof' };
  if (goal.requirementSource !== 'AI' || goal.rankingEligible !== true) {
    return { status: 403, error: 'Goal is not eligible for ranking' };
  }
  if (goal.rankingSettled) return { status: 409, error: 'Ranking points were already awarded' };
  return null;
}

export function rankingInvalidationPatch(input: {
  requirementSource: string | null;
  titleChanged: boolean;
  descriptionChanged: boolean;
  requirementChanged: boolean;
  rankFieldChanged: boolean;
}): { rankingEligible: false; pointsAwarded: 0 } | null {
  if (input.requirementSource !== 'AI') return null;
  const substantive = input.titleChanged || input.descriptionChanged || input.requirementChanged || input.rankFieldChanged;
  if (!substantive) return null;
  return { rankingEligible: false, pointsAwarded: 0 };
}
