import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

export const AI_SUGGESTION_PURPOSE = 'ai-goal-suggestion';
export const AI_SUGGESTION_TTL = '7d';

export type TrustedAiSuggestion = {
  jti: string;
  title: string;
  deadline: string;
  difficultyScore: number;
  difficultyConfidence: number;
  difficultyReason: string;
  pointsAwarded: number;
  xpAwarded: number;
  requirement: string;
  rankField: 'Sport' | 'Academy' | 'Entertainment';
};

export class SuggestionAlreadyUsed extends Error {
  constructor() {
    super('Suggestion already used');
  }
}

export function signAiSuggestion(userId: string, suggestion: Omit<TrustedAiSuggestion, 'jti'>, secret: string) {
  return jwt.sign(
    { purpose: AI_SUGGESTION_PURPOSE, sub: userId, ...suggestion, jti: randomUUID() },
    secret,
    { expiresIn: AI_SUGGESTION_TTL }
  );
}

function sameText(left: string | null | undefined, right: string) {
  return String(left ?? '').trim() === right.trim();
}

function isRankField(value: unknown): value is TrustedAiSuggestion['rankField'] {
  return value === 'Sport' || value === 'Academy' || value === 'Entertainment';
}

export function acceptAiSuggestion(
  token: string,
  secret: string,
  userId: string,
  body: {
    title?: string | null;
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
  const jti = typeof payload?.jti === 'string' ? payload.jti.trim() : '';
  const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
  if (!jti || !title || !isRankField(payload?.rankField)) return { ok: false, error: 'Invalid suggestion' };

  const suggestion: TrustedAiSuggestion = {
    jti,
    title,
    deadline: typeof payload?.deadline === 'string' ? payload.deadline.trim() : '',
    difficultyScore: Number(payload.difficultyScore),
    difficultyConfidence: Number(payload.difficultyConfidence),
    difficultyReason: String(payload.difficultyReason ?? ''),
    pointsAwarded: Number(payload.pointsAwarded),
    xpAwarded: Number(payload.xpAwarded),
    requirement: String(payload.requirement ?? ''),
    rankField: payload.rankField,
  };
  const matches =
    sameText(body.title, suggestion.title) &&
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

export async function claimSuggestionOnce(
  create: (jti: string, userId: string) => Promise<void>,
  jti: string,
  userId: string
): Promise<void> {
  try {
    await create(jti, userId);
  } catch (error) {
    if (error instanceof SuggestionAlreadyUsed) throw error;
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'P2002') throw new SuggestionAlreadyUsed();
    throw error;
  }
}
