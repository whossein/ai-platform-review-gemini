/**
 * OpenAI-compatible LLM provider (ADR-0007) — the first REAL provider.
 *
 * A single adapter that speaks the OpenAI Chat Completions API, which is the
 * de-facto standard also implemented by OpenRouter, Ollama, DeepSeek, Together,
 * Groq, and Azure OpenAI. Point `baseUrl` at any of them and you get real
 * model output through the same provider-agnostic `LLMProvider` contract — no
 * caller changes (agents, router, escalation all stay the same).
 *
 * Examples:
 *   OpenAI     baseUrl https://api.openai.com/v1        model gpt-4o-mini
 *   OpenRouter baseUrl https://openrouter.ai/api/v1     model anthropic/claude-3.5-sonnet
 *   Ollama     baseUrl http://localhost:11434/v1        model qwen2.5-coder  (free/local)
 *   DeepSeek   baseUrl https://api.deepseek.com/v1      model deepseek-chat
 *
 * The transport (`fetch`) is injectable so this is unit-tested offline.
 */

import type {
  AsyncResult,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ModelCapability,
  ModelDescriptor,
  ModelId,
  ModelTier,
  PlatformError,
  ProviderId,
} from '@ai-review/core';
import { resolveProviderPreset } from './provider-catalog.js';

/** One entry per model the caller wants to expose from this provider. */
export interface OpenAICompatibleModel {
  readonly id: string;
  readonly tier: ModelTier;
  readonly capabilities?: readonly ModelCapability[];
  readonly contextWindow?: number;
  readonly inputCostPer1M?: number;
  readonly outputCostPer1M?: number;
}

export interface OpenAICompatibleOptions {
  /** Stable provider id, e.g. 'provider.openai' or 'provider.ollama'. */
  readonly providerId: string;
  /** API base URL including the version segment, e.g. https://api.openai.com/v1 */
  readonly baseUrl: string;
  /** Bearer token. Optional for local servers like Ollama. */
  readonly apiKey?: string;
  /** Models this provider should advertise to the router. */
  readonly models: readonly OpenAICompatibleModel[];
  /** Injected for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

function llmError(code: string, message: string, cause?: unknown): PlatformError {
  return { category: 'provider', code, message, ...(cause !== undefined ? { cause } : {}) };
}

const DEFAULT_CAPS: readonly ModelCapability[] = ['text', 'json_mode'];

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: ProviderId;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly descriptors: readonly ModelDescriptor[];

  constructor(opts: OpenAICompatibleOptions) {
    this.id = opts.providerId as ProviderId;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    if (opts.apiKey) this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.descriptors = opts.models.map((m) => ({
      id: m.id as ModelId,
      provider: this.id,
      tier: m.tier,
      capabilities: m.capabilities ?? DEFAULT_CAPS,
      contextWindow: m.contextWindow ?? 128_000,
      inputCostPer1M: m.inputCostPer1M ?? 0,
      outputCostPer1M: m.outputCostPer1M ?? 0,
    }));
  }

  models(): readonly ModelDescriptor[] {
    return this.descriptors;
  }

  async complete(request: LLMRequest): AsyncResult<LLMResponse> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      // Ask for strict JSON when the agent supplied a schema (all reviewers do).
      ...(request.jsonSchema ? { response_format: { type: 'json_object' } } : {}),
      // Explicit: some OpenAI-compatible relays default to SSE streaming when
      // this is omitted, returning `data: {...}` chunks instead of one JSON
      // body. We still parse SSE below as a fallback for relays that ignore it.
      stream: false,
    };

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      return { ok: false, error: llmError('llm.request_failed', 'LLM request failed', cause) };
    }

    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: llmError(
          'llm.http_error',
          `LLM API returned HTTP ${res.status}: ${text.slice(0, 200)}`,
        ),
      };
    }

    type Payload = {
      choices?: Array<{
        message?: { content?: string };
        delta?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    let payload: Payload;
    try {
      payload = JSON.parse(text);
    } catch (cause) {
      // Fallback: some relays stream Server-Sent Events regardless of
      // `stream: false`. Reassemble the `data: {...}` chunks into one response
      // instead of failing the whole call.
      const sse = parseSseChunks<Payload>(text);
      if (!sse) {
        return {
          ok: false,
          error: llmError(
            'llm.bad_response',
            `LLM returned non-JSON body (HTTP ${res.status}): ${text.slice(0, 300)}`,
            cause,
          ),
        };
      }
      payload = sse;
    }

    const choice = payload.choices?.[0];
    const content = choice?.message?.content ?? choice?.delta?.content ?? '';
    const finish = choice?.finish_reason;

    return {
      ok: true,
      value: {
        model: request.model,
        content,
        usage: {
          promptTokens: payload.usage?.prompt_tokens ?? 0,
          completionTokens: payload.usage?.completion_tokens ?? 0,
        },
        finishReason:
          finish === 'length' ? 'length' : finish === 'tool_calls' ? 'tool_use' : 'stop',
      },
    };
  }
}

/**
 * Reassembles a Server-Sent Events stream of OpenAI-style `chat.completion.chunk`
 * events into a single payload shaped like a non-streaming response. Returns
 * `undefined` when `text` doesn't look like SSE at all (a genuinely bad body).
 */
function parseSseChunks<
  T extends {
    choices?: Array<{
      message?: { content?: string };
      delta?: { content?: string };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  },
>(text: string): T | undefined {
  const lines = text.split('\n').filter((l) => l.startsWith('data:'));
  if (lines.length === 0) return undefined;

  let content = '';
  let finishReason: string | undefined;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  for (const line of lines) {
    const data = line.slice('data:'.length).trim();
    if (data === '[DONE]' || data === '') continue;
    try {
      const chunk = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const c = chunk.choices?.[0];
      if (c?.delta?.content) content += c.delta.content;
      if (c?.finish_reason) finishReason = c.finish_reason;
      if (chunk.usage) usage = chunk.usage;
    } catch {
      // Ignore individual malformed chunks; a partial reassembly beats none.
    }
  }

  if (content === '') return undefined;

  return {
    choices: [{ delta: { content }, ...(finishReason ? { finish_reason: finishReason } : {}) }],
    ...(usage ? { usage } : {}),
  } as T;
}

/**
 * Builds a provider from environment variables, or returns undefined when no
 * real credentials are configured (so callers cleanly fall back to the mock).
 *
 * Selection + per-provider overrides (see `provider-catalog.ts` for the full
 * precedence table). In short:
 *   AI_REVIEW_LLM_PROVIDER          which preset: openai | anthropic | gemini |
 *                                   openrouter | ollama | azure | deepseek | custom
 *   AI_REVIEW_<NAME>_BASE_URL       CUSTOM URL override for that provider (proxy)
 *   AI_REVIEW_<NAME>_API_KEY        key for that provider
 *   AI_REVIEW_<NAME>_MODEL          model for that provider
 *   AI_REVIEW_LLM_{BASE_URL,API_KEY,MODEL}   generic fallback (any provider)
 *
 * Every supported provider therefore has its own custom base-URL knob, so any
 * of them can be pointed at a third-party gateway without code changes. The
 * generic `AI_REVIEW_LLM_*` vars remain as a simple provider-agnostic fallback.
 */
export function providerFromEnv(
  env: Record<string, string | undefined> = process.env,
): OpenAICompatibleProvider | undefined {
  // Default to the OpenAI preset when unspecified; unknown values also fall back
  // to OpenAI so a typo never silently disables real reviewing.
  const providerValue = env['AI_REVIEW_LLM_PROVIDER'];
  const preset = resolveProviderPreset(providerValue) ?? resolveProviderPreset('openai')!;
  const p = preset.envPrefix;

  // Per-provider override → generic fallback → preset default (per field).
  const explicitBaseUrl = env[`AI_REVIEW_${p}_BASE_URL`] ?? env['AI_REVIEW_LLM_BASE_URL'];
  const baseUrl = explicitBaseUrl ?? preset.defaultBaseUrl;
  const apiKey = env[`AI_REVIEW_${p}_API_KEY`] ?? env['AI_REVIEW_LLM_API_KEY'];
  const model = env[`AI_REVIEW_${p}_MODEL`] ?? env['AI_REVIEW_LLM_MODEL'] ?? preset.defaultModel;

  // Only build a REAL provider when the user actually configured something —
  // an API key, an explicit provider selection, or an explicit base URL. With
  // an empty environment we return undefined so callers fall back to the mock.
  const configured = Boolean(apiKey) || Boolean(providerValue) || Boolean(explicitBaseUrl);
  if (!configured) return undefined;

  // A real provider still needs a reachable endpoint: a preset default or an
  // explicit base URL. Endpoint-less presets (azure/custom) with none set stay
  // on the mock rather than pointing at nothing.
  if (!baseUrl) return undefined;

  return new OpenAICompatibleProvider({
    providerId: preset.providerId,
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    models: [{ id: model, tier: preset.defaultTier }],
  });
}
