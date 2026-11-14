export function rejectionReason(feedback: string | null | undefined): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = String(feedback ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 3) return { ok: false, error: 'A rejection reason is required' };
  return { ok: true, reason };
}

export function autoReviewFailureWrite(attemptId: string, message: string) {
  const clipped = message.length > 500 ? message.slice(0, 500) : message;
  return {
    where: { id: attemptId, status: 'PENDING_REVIEW' as const },
    data: { aiFeedback: `Auto AI review failed: ${clipped}` },
  };
}
