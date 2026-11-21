export function rejectionReason(feedback: string | null | undefined): { ok: true; reason: string } {
  return { ok: true, reason: String(feedback ?? '').replace(/\s+/g, ' ').trim() };
}

export function autoReviewFailureWrite(attemptId: string, message: string) {
  const clipped = message.length > 500 ? message.slice(0, 500) : message;
  return {
    where: { id: attemptId, status: 'PENDING_REVIEW' as const },
    data: { aiFeedback: `Auto AI review failed: ${clipped}` },
  };
}
