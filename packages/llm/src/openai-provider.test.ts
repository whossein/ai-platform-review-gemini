/**
 * OpenAI-compatible provider tests (ADR-0007).
 *
 * A fake `fetch` simulates the Chat Completions API so the real provider is
 * verified offline: request shape, auth header, JSON-mode, usage mapping, error
 * handling, and env-based construction (incl. the mock-fallback contract).
 */

import { describe, it, expect } from 'vitest';
import type { LLMRequest, ModelId } from '@ai-review/core';
import { OpenAICompatibleProvider, providerFromEnv } from './openai-provider.js';

function fakeFetch(status: number, body: unknown, capture?: (init: RequestInit) => void) {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    capture?.(init ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as Response;
  }) as unknown as typeof fetch;
}

const REQ: LLMRequest = {
  model: 'gpt-4o-mini' as ModelId,
  messages: [
    { role: 'system', content: 'You are a reviewer.' },
    { role: 'user', content: 'Review this.' },
  ],
  temperature: 0.2,
  jsonSchema: { type: 'object' },
};

describe('OpenAICompatibleProvider', () => {
  it('sends a well-formed request and maps the response', async () => {
    let seen: RequestInit = {};
    const provider = new OpenAICompatibleProvider({
      providerId: 'provider.openai',
      baseUrl: 'https://api.openai.com/v1/',
      apiKey: 'sk-test',
      models: [{ id: 'gpt-4o-mini', tier: 'cheap' }],
      fetchImpl: fakeFetch(
        200,
        {
          choices: [{ message: { content: '{"issues":[]}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        },
        (init) => (seen = init),
      ),
    });

    const res = await provider.complete(REQ);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.content).toBe('{"issues":[]}');
      expect(res.value.usage.promptTokens).toBe(12);
      expect(res.value.finishReason).toBe('stop');
    }

    // Auth header + JSON mode + model are in the request body.
    const headers = seen.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-test');
    const body = JSON.parse(String(seen.body));
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.temperature).toBe(0.2);
  });

  it('omits the auth header when no api key (e.g. local Ollama)', async () => {
    let seen: RequestInit = {};
    const provider = new OpenAICompatibleProvider({
      providerId: 'provider.ollama',
      baseUrl: 'http://localhost:11434/v1',
      models: [{ id: 'qwen2.5-coder', tier: 'local' }],
      fetchImpl: fakeFetch(
        200,
        { choices: [{ message: { content: '{}' } }], usage: {} },
        (init) => (seen = init),
      ),
    });
    await provider.complete({ ...REQ, model: 'qwen2.5-coder' as ModelId });
    const headers = seen.headers as Record<string, string>;
    expect(headers['authorization']).toBeUndefined();
  });

  it('surfaces HTTP errors', async () => {
    const provider = new OpenAICompatibleProvider({
      providerId: 'provider.openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'bad',
      models: [{ id: 'gpt-4o-mini', tier: 'cheap' }],
      fetchImpl: fakeFetch(401, { error: 'unauthorized' }),
    });
    const res = await provider.complete(REQ);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('llm.http_error');
  });

  it('advertises its configured models to the router', () => {
    const provider = new OpenAICompatibleProvider({
      providerId: 'provider.openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [{ id: 'gpt-4o-mini', tier: 'cheap', inputCostPer1M: 0.15 }],
    });
    const models = provider.models();
    expect(models[0]?.id).toBe('gpt-4o-mini');
    expect(models[0]?.capabilities).toContain('json_mode');
  });
});

describe('providerFromEnv', () => {
  it('returns undefined when no credentials are set (falls back to mock)', () => {
    expect(providerFromEnv({})).toBeUndefined();
  });

  it('builds an OpenAI provider from an API key', () => {
    const p = providerFromEnv({ AI_REVIEW_LLM_API_KEY: 'sk-x' });
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it('builds a keyless local provider from a base URL (Ollama)', () => {
    const p = providerFromEnv({ AI_REVIEW_LLM_BASE_URL: 'http://localhost:11434/v1' });
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
  });
});
