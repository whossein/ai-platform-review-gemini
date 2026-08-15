/**
 * Provider catalog + env-resolution tests (ADR-0007).
 *
 * Verifies that every provider preset resolves, and that each one honours its
 * per-provider custom base-URL override (the third-party-proxy requirement)
 * with the documented precedence: AI_REVIEW_<NAME>_* → AI_REVIEW_LLM_* → preset.
 */

import { describe, it, expect } from 'vitest';
import { providerFromEnv } from './openai-provider.js';
import { PROVIDER_CATALOG, resolveProviderPreset } from './provider-catalog.js';

/** Reach the private baseUrl for assertions without widening the public type. */
function baseUrlOf(p: unknown): string {
  return (p as { baseUrl: string }).baseUrl;
}

describe('resolveProviderPreset', () => {
  it('resolves canonical keys and aliases case-insensitively', () => {
    expect(resolveProviderPreset('anthropic')?.key).toBe('anthropic');
    expect(resolveProviderPreset('Claude')?.key).toBe('anthropic');
    expect(resolveProviderPreset('GEMINI')?.key).toBe('gemini');
    expect(resolveProviderPreset('proxy')?.key).toBe('custom');
    expect(resolveProviderPreset('nope')).toBeUndefined();
    expect(resolveProviderPreset(undefined)).toBeUndefined();
  });

  it('gives every preset its own env prefix for a custom base URL', () => {
    for (const preset of PROVIDER_CATALOG) {
      expect(preset.envPrefix).toMatch(/^[A-Z]+$/);
    }
  });
});

describe('providerFromEnv — selection', () => {
  it('returns undefined (fall back to mock) when nothing is configured', () => {
    expect(providerFromEnv({})).toBeUndefined();
  });

  it('defaults to OpenAI when a key is present but no provider is named', () => {
    const p = providerFromEnv({ AI_REVIEW_LLM_API_KEY: 'sk-x' });
    expect(p?.id).toBe('provider.openai');
    expect(baseUrlOf(p)).toBe('https://api.openai.com/v1');
  });

  it('selects Anthropic/Claude with its preset default endpoint', () => {
    const p = providerFromEnv({
      AI_REVIEW_LLM_PROVIDER: 'claude',
      AI_REVIEW_ANTHROPIC_API_KEY: 'sk-ant',
    });
    expect(p?.id).toBe('provider.anthropic');
    expect(baseUrlOf(p)).toBe('https://api.anthropic.com/v1');
  });

  it('works keyless for local Ollama via its default base URL', () => {
    const p = providerFromEnv({ AI_REVIEW_LLM_PROVIDER: 'ollama' });
    expect(p?.id).toBe('provider.ollama');
    expect(baseUrlOf(p)).toBe('http://localhost:11434/v1');
  });

  it('stays on the mock for endpoint-less providers (azure) with no base URL', () => {
    // Azure has no fixed endpoint; a key alone is not enough to reach it.
    expect(
      providerFromEnv({ AI_REVIEW_LLM_PROVIDER: 'azure', AI_REVIEW_AZURE_API_KEY: 'k' }),
    ).toBeUndefined();
  });
});

describe('providerFromEnv — custom base URL (third-party proxy)', () => {
  it('per-provider override beats everything else', () => {
    const p = providerFromEnv({
      AI_REVIEW_LLM_PROVIDER: 'openai',
      AI_REVIEW_OPENAI_BASE_URL: 'https://gateway.corp/openai/v1',
      AI_REVIEW_LLM_BASE_URL: 'https://ignored.example/v1',
      AI_REVIEW_OPENAI_API_KEY: 'sk-x',
    });
    expect(baseUrlOf(p)).toBe('https://gateway.corp/openai/v1');
  });

  it('generic AI_REVIEW_LLM_BASE_URL applies when no per-provider override is set', () => {
    const p = providerFromEnv({
      AI_REVIEW_LLM_PROVIDER: 'deepseek',
      AI_REVIEW_LLM_BASE_URL: 'https://proxy.local/v1',
      AI_REVIEW_DEEPSEEK_API_KEY: 'sk-ds',
    });
    expect(p?.id).toBe('provider.deepseek');
    expect(baseUrlOf(p)).toBe('https://proxy.local/v1');
  });

  it('lets the fully-custom provider point at an arbitrary gateway', () => {
    const p = providerFromEnv({
      AI_REVIEW_LLM_PROVIDER: 'custom',
      AI_REVIEW_CUSTOM_BASE_URL: 'https://my-relay.internal/v1',
      AI_REVIEW_CUSTOM_MODEL: 'my-model',
    });
    expect(p?.id).toBe('provider.custom');
    expect(baseUrlOf(p)).toBe('https://my-relay.internal/v1');
    expect(p?.models()[0]?.id).toBe('my-model');
  });

  it('per-provider model override wins over the generic and preset defaults', () => {
    const p = providerFromEnv({
      AI_REVIEW_LLM_PROVIDER: 'gemini',
      AI_REVIEW_GEMINI_API_KEY: 'k',
      AI_REVIEW_GEMINI_MODEL: 'gemini-1.5-pro',
      AI_REVIEW_LLM_MODEL: 'ignored',
    });
    expect(p?.models()[0]?.id).toBe('gemini-1.5-pro');
  });
});
