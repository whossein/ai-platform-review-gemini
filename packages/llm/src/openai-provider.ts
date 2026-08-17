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

/**
 * Normalizes OpenAI-compatible base URLs:
 * - Ensures a valid protocol (https:// or http:// for localhost/ip)
 * - Strips accidental /chat/completions or /chat path suffixes
 * - Strips trailing slashes
 */
export function normalizeBaseUrl(input: string | undefined): string {
  let url = (input || '').trim();
  if (!url) return '';

  // 1. Add protocol if missing
  if (!/^https?:\/\//i.test(url)) {
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(url)) {
      url = `http://${url}`;
    } else {
      url = `https://${url}`;
    }
  }

  // 2. Remove trailing slashes
  url = url.replace(/\/+$/, '');

  // 3. Remove accidental /chat/completions or /chat endpoint suffixes
  if (url.endsWith('/chat/completions')) {
    url = url.slice(0, -'/chat/completions'.length);
  } else if (url.endsWith('/chat')) {
    url = url.slice(0, -'/chat'.length);
  }

  // 4. Remove trailing slashes again
  url = url.replace(/\/+$/, '');

  return url;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: ProviderId;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly descriptors: readonly ModelDescriptor[];

  constructor(opts: OpenAICompatibleOptions) {
    this.id = opts.providerId as ProviderId;
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    if (opts.apiKey) this.apiKey = opts.apiKey.trim();
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

    const cleanKey = this.apiKey ? this.apiKey.trim().replace(/^["']|["']$/g, '') : undefined;
    const rawKey = cleanKey ? cleanKey.replace(/^Bearer\s+/i, '').trim() : undefined;

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'keep-alive',
    };

    if (rawKey) {
      // Standard RFC-6750 Authorization Bearer header
      requestHeaders['Authorization'] = `Bearer ${rawKey}`;

      // Additional provider-specific header compatibility
      requestHeaders['x-api-key'] = rawKey;
      requestHeaders['api-key'] = rawKey;
      requestHeaders['x-goog-api-key'] = rawKey;
      requestHeaders['HTTP-Referer'] = 'https://ai-review-platform.local';
      requestHeaders['X-Title'] = 'AI Review Platform';
    }

    let targetEndpoint = `${this.baseUrl}/chat/completions`;
    if (rawKey && (this.baseUrl.includes('googleapis.com') || this.baseUrl.includes('generativelanguage')) && !targetEndpoint.includes('key=')) {
      const separator = targetEndpoint.includes('?') ? '&' : '?';
      targetEndpoint = `${targetEndpoint}${separator}key=${encodeURIComponent(rawKey)}`;
    }

    let signal: AbortSignal | undefined;
    try {
      if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
        signal = AbortSignal.timeout(240_000); // 4 minutes timeout per individual agent query
      }
    } catch {
      // signal timeout not supported
    }

    let res: Response;
    try {
      res = await this.fetchImpl(targetEndpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (cause: any) {
      const isTimeout = cause?.name === 'TimeoutError' || cause?.message?.includes('timeout') || cause?.message?.includes('aborted');
      const hint = isTimeout ? ' (Request timed out after 240s)' : '';
      return { 
        ok: false, 
        error: llmError(
          'llm.request_failed', 
          `LLM request to "${targetEndpoint}" failed${hint}: ${cause?.message || String(cause)}`, 
          cause
        ) 
      };
    }

    let text = await res.text();

    // Auto-retry if the model rejected `temperature` (e.g., o1/o3 reasoning models or custom provider restrictions)
    if (!res.ok && res.status === 400 && body.temperature !== undefined && text.toLowerCase().includes('temperature')) {
      delete body.temperature;
      try {
        const retryRes = await this.fetchImpl(targetEndpoint, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(body),
          ...(signal ? { signal } : {}),
        });
        if (retryRes.ok) {
          res = retryRes;
          text = await retryRes.text();
        }
      } catch {
        // keep original response
      }
    }

    // Auto-retry if the model rejected `response_format` (json_object)
    if (!res.ok && res.status === 400 && body.response_format && text.toLowerCase().includes('response_format')) {
      delete body.response_format;
      try {
        const retryRes = await this.fetchImpl(targetEndpoint, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(body),
          ...(signal ? { signal } : {}),
        });
        if (retryRes.ok) {
          res = retryRes;
          text = await retryRes.text();
        }
      } catch {
        // keep original response
      }
    }

    if (!res.ok) {
      const isUnauthorized = res.status === 401 || res.status === 403;
      const authHint = isUnauthorized 
        ? ` (Authentication failed with HTTP ${res.status}. Verify that your API key is valid and has correct permissions)`
        : '';

      return {
        ok: false,
        error: llmError(
          'llm.http_error',
          `LLM API (${targetEndpoint}) returned HTTP ${res.status}${authHint}: ${text.slice(0, 300)}`,
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
export function resolveApiKey(
  provider: string,
  envPrefix: string,
  explicitKey?: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (explicitKey && explicitKey.trim()) return explicitKey.trim();

  const specific = env[`AI_REVIEW_${envPrefix}_API_KEY`];
  if (specific && specific.trim()) return specific.trim();

  const generic = env['AI_REVIEW_LLM_API_KEY'];
  if (generic && generic.trim()) return generic.trim();

  // Provider-specific standard aliases
  const aliases: Record<string, string[]> = {
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'AI_REVIEW_GEMINI_API_KEY'],
    openai: ['OPENAI_API_KEY', 'AI_REVIEW_OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY', 'AI_REVIEW_ANTHROPIC_API_KEY'],
    deepseek: ['DEEPSEEK_API_KEY', 'AI_REVIEW_DEEPSEEK_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY', 'AI_REVIEW_OPENROUTER_API_KEY'],
    azure: ['AZURE_OPENAI_API_KEY', 'AZURE_API_KEY', 'AI_REVIEW_AZURE_API_KEY'],
  };

  const aliasList = aliases[provider.toLowerCase()] || [];
  for (const alias of aliasList) {
    const val = env[alias];
    if (val && val.trim()) return val.trim();
  }

  return undefined;
}

export function providerFromEnv(
  env: Record<string, string | undefined> = process.env,
): OpenAICompatibleProvider | undefined {
  const providerValue = env['AI_REVIEW_LLM_PROVIDER'];
  if (providerValue === 'mock') return undefined;

  const preset = resolveProviderPreset(providerValue) ?? resolveProviderPreset('openai')!;
  const p = preset.envPrefix;

  // Per-provider override → generic fallback → preset default (per field).
  const explicitBaseUrl = env[`AI_REVIEW_${p}_BASE_URL`] ?? env['AI_REVIEW_LLM_BASE_URL'];
  const rawBaseUrl = explicitBaseUrl ?? preset.defaultBaseUrl;
  const baseUrl = rawBaseUrl ? normalizeBaseUrl(rawBaseUrl) : undefined;
  const apiKey = resolveApiKey(preset.key, p, undefined, env);
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
    models: [{
      id: model,
      tier: preset.defaultTier,
      inputCostPer1M: preset.defaultInputCostPer1M ?? 0,
      outputCostPer1M: preset.defaultOutputCostPer1M ?? 0,
    }],
  });
}

export function providersFromEnv(
  env: Record<string, string | undefined> = process.env,
): OpenAICompatibleProvider[] {
  const providerValue = env['AI_REVIEW_LLM_PROVIDER'];
  if (providerValue === 'mock') return [];

  if (env['AI_PROVIDERS_JSON']) {
    try {
      const providersData = JSON.parse(env['AI_PROVIDERS_JSON']);
      const providers: OpenAICompatibleProvider[] = [];

      // Sort providers so any matching active provider comes first
      const sortedProvidersData = [...providersData];
      if (providerValue) {
        sortedProvidersData.sort((a, b) => {
          if (a.id === providerValue || a.provider === providerValue) return -1;
          if (b.id === providerValue || b.provider === providerValue) return 1;
          return 0;
        });
      }

      for (const data of sortedProvidersData) {
        if (data.provider === 'mock') continue;
        const preset = resolveProviderPreset(data.provider) ?? resolveProviderPreset('openai')!;
        const rawBaseUrl = data.baseUrl || preset.defaultBaseUrl;
        if (!rawBaseUrl) continue;
        const baseUrl = normalizeBaseUrl(rawBaseUrl);
        const tier = (data.tier || preset.defaultTier) as ModelTier;
        const apiKey = resolveApiKey(data.provider, preset.envPrefix, data.apiKey, env);
        const inputCostPer1M = typeof data.inputCostPer1M === 'number'
          ? data.inputCostPer1M
          : (preset.defaultInputCostPer1M ?? 0);
        const outputCostPer1M = typeof data.outputCostPer1M === 'number'
          ? data.outputCostPer1M
          : (preset.defaultOutputCostPer1M ?? 0);

        providers.push(
          new OpenAICompatibleProvider({
            providerId: data.id ? `provider.${data.provider}-${data.id}` : preset.providerId,
            baseUrl,
            ...(apiKey ? { apiKey } : {}),
            models: [{
              id: data.model || preset.defaultModel,
              tier,
              inputCostPer1M,
              outputCostPer1M,
            }],
          }),
        );
      }
      if (providers.length > 0) return providers;
    } catch (e) {
      console.error('Failed to parse AI_PROVIDERS_JSON', e);
    }
  }

  // Fallback to legacy single provider if no JSON array
  const single = providerFromEnv(env);
  return single ? [single] : [];
}
