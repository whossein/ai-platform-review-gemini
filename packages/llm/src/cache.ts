/**
 * LLM response cache (ADR-0007, the #1 token/$ lever).
 *
 * `CachingLLMClient` is a transparent decorator around any `LLMClient`. Before
 * calling the underlying (paid) client it looks up a content-addressed key
 * derived from the *semantic* request — messages, temperature, maxTokens, and
 * json schema. On a hit it returns the stored response tagged `fromCache: true`
 * with **zero** prompt/completion tokens, so identical calls across agents,
 * retries, or re-runs never cost twice.
 *
 * Determinism note: caching a non-zero-temperature request trades some variance
 * for cost. That is the intended platform default (reproducible, cheap reviews);
 * callers that truly need fresh sampling can bypass the cache by using a client
 * without this decorator.
 */

import type {
  AsyncResult,
  Cache,
  CacheKey,
  LLMClient,
  LLMRequest,
  LLMResponse,
  ModelId,
} from '@ai-review/core';
import { hashObject } from '@ai-review/shared';

type Completable = Omit<LLMRequest, 'model'> & { model?: ModelId };

/** Build a stable key from the parts of a request that change the output. */
export function llmRequestKey(request: Completable): CacheKey {
  const canonical = {
    model: request.model ?? '(routed)',
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: request.temperature ?? null,
    maxTokens: request.maxTokens ?? null,
    jsonSchema: request.jsonSchema ?? null,
  };
  return `llm_response:${hashObject(canonical)}` as CacheKey;
}

export class CachingLLMClient implements LLMClient {
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(
    private readonly inner: LLMClient,
    private readonly cache: Cache<LLMResponse>,
  ) {}

  get hits(): number {
    return this.cacheHits;
  }
  get misses(): number {
    return this.cacheMisses;
  }

  async complete(request: Completable): AsyncResult<LLMResponse> {
    const key = llmRequestKey(request);

    const cached = await this.cache.get(key);
    if (cached.ok && cached.value) {
      this.cacheHits++;
      // Zero out usage: a cache hit costs nothing, and report it as cached.
      return {
        ok: true,
        value: {
          ...cached.value.value,
          usage: { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0 },
          fromCache: true,
        },
      };
    }

    this.cacheMisses++;
    const result = await this.inner.complete(request);
    if (result.ok) {
      // Only cache successful, non-error completions.
      if (result.value.finishReason !== 'error') {
        await this.cache.set(key, result.value);
      }
    }
    return result;
  }
}
