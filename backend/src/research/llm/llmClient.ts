/**
 * Model adapter for recovery experiments. Phase 4 can replace the direct
 * client with MCP without changing the planner loop.
 * The API key stays in this closure and is never copied into a result.
 */

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmCompletionRequest = {
  messages: LlmMessage[];
  temperature: number;
  jsonObject: boolean;
  maxOutputTokens: number;
};

export type LlmCompletion = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
};

export type LlmClient = {
  provider: string;
  model: string;
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
};

export class LlmProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

export function redactSecrets(text: string, secret?: string): string {
  let redacted = text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
  redacted = redacted.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]');
  if (secret && secret.length > 0) redacted = redacted.split(secret).join('[redacted]');
  return redacted;
}

export const LLM_TEMPERATURE = 0;
export const LLM_MAX_OUTPUT_TOKENS = 2000;

export function createOpenAiRecoveryClient(options: {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): LlmClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new LlmProviderError('Missing OpenAI API key');
  const model = options.model?.trim() || 'gpt-4o-mini';
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    provider: 'openai',
    model,
    async complete(request) {
      let response: Response;
      try {
        response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: request.temperature,
            max_tokens: request.maxOutputTokens,
            ...(request.jsonObject ? { response_format: { type: 'json_object' } } : {}),
            messages: request.messages,
          }),
          signal: AbortSignal.timeout(45000),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'OpenAI request failed';
        throw new LlmProviderError(redactSecrets(message, apiKey));
      }
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      } | null;
      if (!response.ok) {
        const message = body?.error?.message ?? `OpenAI request failed with status ${response.status}`;
        throw new LlmProviderError(redactSecrets(message, apiKey));
      }
      const text = body?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new LlmProviderError('OpenAI response did not include text');
      return {
        text,
        inputTokens: readCount(body?.usage?.prompt_tokens),
        outputTokens: readCount(body?.usage?.completion_tokens),
        estimatedCostUsd: null,
      };
    },
  };
}

function readCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
