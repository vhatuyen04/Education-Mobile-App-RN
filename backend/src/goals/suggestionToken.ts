import jwt from 'jsonwebtoken';

export const AI_SUGGESTION_PURPOSE = 'ai-goal-suggestion';
export const AI_SUGGESTION_TTL = '7d';

export type TrustedAiSuggestion = {
  difficultyScore: number;
  difficultyConfidence: number;
  difficultyReason: string;
  pointsAwarded: number;
  xpAwarded: number;
  requirement: string;
  rankField: 'Sport' | 'Academy' | 'Entertainment';
};

export function signAiSuggestion(userId: string, suggestion: TrustedAiSuggestion, secret: string) {
  return jwt.sign({ purpose: AI_SUGGESTION_PURPOSE, sub: userId, ...suggestion }, secret, { expiresIn: AI_SUGGESTION_TTL });
}

function sameText(left: string | null | undefined, right: string) {
  return String(left ?? '').trim() === right.trim();
}

export function acceptAiSuggestion(
  token: string,
  secret: string,
  userId: string,
  body: {
    difficultyScore?: number;
    difficultyConfidence?: number;
    difficultyReason?: string;
    pointsAwarded?: number;
    xpAwarded?: number;
    requirement?: string | null;
    rankField?: 'Sport' | 'Academy' | 'Entertainment';
  }
): { ok: true; suggestion: TrustedAiSuggestion } | { ok: false; error: string } {
  let payload: any;
  try {
    payload = jwt.verify(token, secret);
  } catch (error) {
    const expired = error instanceof Error && error.name === 'TokenExpiredError';
    return { ok: false, error: expired ? 'Suggestion expired' : 'Invalid suggestion' };
  }
  if (payload?.purpose !== AI_SUGGESTION_PURPOSE) return { ok: false, error: 'Invalid suggestion' };
  if (String(payload?.sub ?? '') !== userId) return { ok: false, error: 'Suggestion does not match this user' };

  const suggestion: TrustedAiSuggestion = {
    difficultyScore: Number(payload.difficultyScore),
    difficultyConfidence: Number(payload.difficultyConfidence),
    difficultyReason: String(payload.difficultyReason ?? ''),
    pointsAwarded: Number(payload.pointsAwarded),
    xpAwarded: Number(payload.xpAwarded),
    requirement: String(payload.requirement ?? ''),
    rankField: payload.rankField,
  };
  const matches =
    body.difficultyScore === suggestion.difficultyScore &&
    body.difficultyConfidence === suggestion.difficultyConfidence &&
    sameText(body.difficultyReason, suggestion.difficultyReason) &&
    body.pointsAwarded === suggestion.pointsAwarded &&
    body.xpAwarded === suggestion.xpAwarded &&
    sameText(body.requirement, suggestion.requirement) &&
    body.rankField === suggestion.rankField;
  if (!matches) return { ok: false, error: 'Suggestion does not match the goal' };
  return { ok: true, suggestion };
}
