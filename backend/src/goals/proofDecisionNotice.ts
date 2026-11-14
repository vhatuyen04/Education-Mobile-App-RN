export function proofDecisionNotice(input: {
  goalTitle: string;
  status: 'APPROVED' | 'REJECTED';
  reviewer: 'admin' | 'AI';
  reason?: string | null;
}) {
  const who = input.reviewer === 'AI' ? 'AI' : 'an admin';
  const verb = input.status === 'APPROVED' ? 'approved' : 'rejected';
  const title = input.status === 'APPROVED' ? 'Proof approved' : 'Proof rejected';
  const reason = String(input.reason ?? '').trim();
  const reasonSentence =
    input.status === 'REJECTED' ? (reason ? ` Reason: ${reason}` : ' No reason was provided.') : '';
  return {
    title,
    body: `${input.goalTitle} was ${verb} by ${who}.${reasonSentence}`,
    reviewer: input.reviewer,
    reason: reason || null,
  };
}
