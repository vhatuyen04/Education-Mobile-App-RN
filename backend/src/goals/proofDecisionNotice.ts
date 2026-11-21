export function proofDecisionNotice(input: {
  goalTitle: string;
  status: 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION';
  reviewer: 'admin' | 'AI';
  reason?: string | null;
}) {
  const who = input.reviewer === 'AI' ? 'AI' : 'an admin';
  const reason = String(input.reason ?? '').trim();
  if (input.status === 'NEEDS_CLARIFICATION') {
    const reasonSentence = reason ? ` Reason: ${reason}` : ' No reason was provided.';
    return {
      title: 'Clearer proof needed',
      body: `${input.goalTitle} needs clearer evidence before it can be reviewed again.${reasonSentence}`,
      reviewer: input.reviewer,
      reason: reason || null,
    };
  }
  const verb = input.status === 'APPROVED' ? 'approved' : 'rejected';
  const title = input.status === 'APPROVED' ? 'Proof approved' : 'Proof rejected';
  const reasonSentence =
    input.status === 'REJECTED' ? (reason ? ` Reason: ${reason}` : ' No reason was provided.') : '';
  return {
    title,
    body: `${input.goalTitle} was ${verb} by ${who}.${reasonSentence}`,
    reviewer: input.reviewer,
    reason: reason || null,
  };
}
