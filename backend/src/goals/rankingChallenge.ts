import { createHash, randomInt, timingSafeEqual } from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RANKING_PROOF_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export function rankingProofDeadline(completedAt: Date): Date {
  return new Date(completedAt.getTime() + RANKING_PROOF_WINDOW_MS);
}

export type ChallengeBinding = { userId: string; goalId: string; attemptId: string };

export function createRankingChallenge(binding: ChallengeBinding, expiresAt: Date): { code: string; hash: string; expiresAt: Date } {
  let code = '';
  for (let i = 0; i < 8; i += 1) code += ALPHABET[randomInt(0, ALPHABET.length)];
  return {
    code,
    hash: hashRankingChallenge(code, binding),
    expiresAt,
  };
}

export function hashRankingChallenge(code: string, binding: ChallengeBinding): string {
  const normalized = String(code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return createHash('sha256')
    .update(`smartgoal-ranking-challenge:v1:${binding.userId}:${binding.goalId}:${binding.attemptId}:${normalized}`)
    .digest('hex');
}

export function verifyRankingChallenge(code: string, hash: string | null | undefined, binding: ChallengeBinding): boolean {
  if (!hash || !String(code ?? '').trim()) return false;
  const next = hashRankingChallenge(code, binding);
  const left = Buffer.from(next);
  const right = Buffer.from(String(hash));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function challengeSubmissionDenial(expiresAt: Date | null, now: Date): { status: 400; error: string } | null {
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return { status: 400, error: 'Challenge is invalid' };
  if (now.getTime() > expiresAt.getTime()) return { status: 400, error: 'Challenge expired' };
  return null;
}
