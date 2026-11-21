export const SAMPLED_FRAME_LIMITATION =
  'Moderation uses a sparse sample of video frames and cannot guarantee the entire video is safe.';

export const CONTENT_MODERATION_SYSTEM =
  'You are a content-safety moderator for a goal-tracking app. You do not verify achievements, count repetitions, approve submissions, or award points. Look only for sexual content, sexual content involving minors, graphic violence, hate, self-harm, toxic content, or abnormal harmful content. Return FLAGGED only when the description or a supplied frame shows one of those. Return CLEAR in every other case, including a dark, incomplete, unrelated, or unclear sample. Return ONLY JSON: {"verdict":"CLEAR"|"FLAGGED","note":"short reason"}.';

export type ModerationVerdict = 'CLEAR' | 'FLAGGED';

export type ModerationResult = {
  verdict: ModerationVerdict;
  note: string;
};

export function withFrameLimitation(note: string): string {
  const text = String(note ?? '').trim();
  if (text.includes(SAMPLED_FRAME_LIMITATION)) return text;
  return text ? `${text} ${SAMPLED_FRAME_LIMITATION}` : SAMPLED_FRAME_LIMITATION;
}

export function moderationFailure(message: string): ModerationResult {
  const reason = String(message ?? '').trim() || 'Moderation did not flag the video';
  return { verdict: 'CLEAR', note: withFrameLimitation(reason) };
}

export function parseModerationResponse(content: string): ModerationResult {
  try {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    const jsonText = start >= 0 && end > start ? content.slice(start, end + 1) : content;
    const parsed = JSON.parse(jsonText) as { verdict?: unknown; note?: unknown };
    const verdict = parsed.verdict;
    const note = typeof parsed.note === 'string' ? parsed.note : '';
    if (verdict === 'FLAGGED') return { verdict, note: withFrameLimitation(note) };
    return { verdict: 'CLEAR', note: withFrameLimitation(note || 'No disallowed content was found') };
  } catch {
    // A missing or malformed response is not evidence that the video is safe.
  }
  return moderationFailure('Moderation response was not usable');
}

export function moderationUpdateForStatus(status: string, result: ModerationResult, checkedAt: Date) {
  if (status !== 'PENDING_UPLOAD') return null;
  return {
    status: 'PENDING_REVIEW' as const,
    moderationStatus: result.verdict,
    moderationNote: result.note,
    moderationCheckedAt: checkedAt,
  };
}

export function releasedProofUrl(status: string, proofUrl: string | null | undefined): string | null {
  if (status !== 'APPROVED') return null;
  const url = String(proofUrl ?? '').trim();
  return url || null;
}

export async function requestContentModeration(params: {
  apiKey: string;
  description: string;
  frames: Buffer[];
  fetchImpl?: typeof fetch;
}): Promise<ModerationResult> {
  if (!params.apiKey.trim()) return moderationFailure('Moderation is not configured');
  if (params.frames.length === 0) return moderationFailure('No visual sample could be read');

  const images = params.frames.slice(0, 8).map(frame => ({
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${frame.toString('base64')}` },
  }));
  const call = params.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await call('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0,
        messages: [
          { role: 'system', content: CONTENT_MODERATION_SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Achievement description:\n${params.description || '(none)'}` },
              ...images,
            ],
          },
        ],
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Moderation request failed';
    return moderationFailure(message);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data ? String((data as { error?: { message?: unknown } }).error?.message ?? '') : '';
    return moderationFailure(message || 'Moderation request failed');
  }
  const content = String((data as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message?.content ?? '');
  return parseModerationResponse(content);
}
