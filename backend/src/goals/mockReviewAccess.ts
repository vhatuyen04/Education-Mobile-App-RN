export function mockReviewAccess(input: {
  nodeEnv: string | undefined;
  allowMockReview: string | undefined;
  isAdmin: boolean;
}): { ok: true } | { ok: false; status: 403; error: string } {
  const forbidden = { ok: false as const, status: 403 as const, error: 'Forbidden' };
  if ((input.nodeEnv ?? '').toLowerCase() === 'production') return forbidden;
  const optedIn = input.allowMockReview === '1' || input.allowMockReview?.toLowerCase() === 'true';
  if (!optedIn || !input.isAdmin) return forbidden;
  return { ok: true };
}
