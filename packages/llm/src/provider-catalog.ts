/**
 * Provider catalog (ADR-0007) — named presets for every supported LLM vendor,
 * each with a **custom base-URL override** so any provider can be routed through
 * a third-party gateway/proxy (LiteLLM, Cloudflare AI Gateway, a corporate
 * egress, a self-hosted relay, …) without touching code.
 *
 * All vendors here are consumed through the single OpenAI-compatible adapter
 * (`OpenAICompatibleProvider`): OpenAI, Anthropic/Claude, Google/Gemini,
 * OpenRouter, Ollama, Azure OpenAI, and DeepSeek all expose an OpenAI Chat
 * Completions surface (natively or via a compat endpoint). Adding a new vendor
 * is one entry in `PROVIDER_CATALOG` — no caller changes (agents, router,
 * escalation, cache all stay identical).
 *
 * ── Env resolution (per provider) ────────────────────────────────────────────
 * Selected provider:  AI_REVIEW_LLM_PROVIDER   (e.g. "anthropic"; default "openai")
 *
 * For the selected provider `<NAME>` (OPENAI, ANTHROPIC, GEMINI, OPENROUTER,
 * OLLAMA, AZURE, DEEPSEEK, CUSTOM) each setting is resolved with this precedence:
 *   base URL:  AI_REVIEW_<NAME>_BASE_URL  →  AI_REVIEW_LLM_BASE_URL  →  preset default
 *   api key:   AI_REVIEW_<NAME>_API_KEY   →  AI_REVIEW_LLM_API_KEY
 *   model:     AI_REVIEW_<NAME>_MODEL     →  AI_REVIEW_LLM_MODEL     →  preset default
 *
 * The per-provider `AI_REVIEW_<NAME>_BASE_URL` is the "custom URL" knob: set it
 * to your proxy and everything else stays the same. The generic `AI_REVIEW_LLM_*`
 * still works as a provider-agnostic fallback for simple setups.
 */

import type { ModelTier } from '@ai-review/core';

/** Canonical keys accepted by `AI_REVIEW_LLM_PROVIDER`. */
export type ProviderKey =
  'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'ollama' | 'azure' | 'deepseek' | 'avalai' | 'custom';

export interface ProviderPreset {
  /** Canonical selector key (matches `AI_REVIEW_LLM_PROVIDER`). */
  readonly key: ProviderKey;
  /** Stable provider id surfaced to the router/telemetry. */
  readonly providerId: string;
  /** Human label for docs/logs. */
  readonly label: string;
  /** Env var prefix for the per-provider overrides, e.g. "ANTHROPIC". */
  readonly envPrefix: string;
  /**
   * Default OpenAI-compatible base URL (including version segment). `undefined`
   * for providers that have no single fixed endpoint (Azure resource-specific,
   * or the fully user-defined "custom" provider) — those require an explicit
   * base URL via env.
   */
  readonly defaultBaseUrl?: string;
  /** Default model id when the caller does not specify one. */
  readonly defaultModel: string;
  /** Whether a real deployment normally needs an API key (Ollama does not). */
  readonly requiresApiKey: boolean;
  /** Default cost tier used by the router until richer pricing is configured. */
  readonly defaultTier: ModelTier;
  /** Default USD per 1M input tokens */
  readonly defaultInputCostPer1M?: number;
  /** Default USD per 1M output tokens */
  readonly defaultOutputCostPer1M?: number;
  /** Common aliases accepted for `AI_REVIEW_LLM_PROVIDER`. */
  readonly aliases?: readonly string[];
}

/**
 * One entry per supported vendor. Every entry has a per-provider base-URL
 * override (via `envPrefix`) so it can be pointed at a third-party proxy.
 */
export const PROVIDER_CATALOG: readonly ProviderPreset[] = [
  {
    key: 'openai',
    providerId: 'provider.openai',
    label: 'OpenAI',
    envPrefix: 'OPENAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    requiresApiKey: true,
    defaultTier: 'cheap',
    defaultInputCostPer1M: 0.15,
    defaultOutputCostPer1M: 0.60,
    aliases: ['gpt', 'openai-compatible'],
  },
  {
    key: 'anthropic',
    providerId: 'provider.anthropic',
    label: 'Anthropic (Claude)',
    envPrefix: 'ANTHROPIC',
    // Anthropic's OpenAI-compatible surface.
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-haiku-latest',
    requiresApiKey: true,
    defaultTier: 'cheap',
    defaultInputCostPer1M: 0.80,
    defaultOutputCostPer1M: 4.00,
    aliases: ['claude'],
  },
  {
    key: 'gemini',
    providerId: 'provider.gemini',
    label: 'Google Gemini',
    envPrefix: 'GEMINI',
    // Google's OpenAI-compatible endpoint.
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-1.5-flash',
    requiresApiKey: true,
    defaultTier: 'cheap',
    defaultInputCostPer1M: 0.075,
    defaultOutputCostPer1M: 0.30,
    aliases: ['google'],
  },
  {
    key: 'openrouter',
    providerId: 'provider.openrouter',
    label: 'OpenRouter',
    envPrefix: 'OPENROUTER',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    requiresApiKey: true,
    defaultTier: 'mid',
    defaultInputCostPer1M: 0.15,
    defaultOutputCostPer1M: 0.60,
  },
  {
    key: 'ollama',
    providerId: 'provider.ollama',
    label: 'Ollama (local)',
    envPrefix: 'OLLAMA',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder',
    requiresApiKey: false, // local server needs no key
    defaultTier: 'cheap',
    defaultInputCostPer1M: 0,
    defaultOutputCostPer1M: 0,
    aliases: ['local'],
  },
  {
    key: 'azure',
    providerId: 'provider.azure',
    label: 'Azure OpenAI',
    envPrefix: 'AZURE',
    // Resource-specific — the user MUST supply the full base URL, e.g.
    // https://<resource>.openai.azure.com/openai/deployments/<deployment>
    defaultModel: 'gpt-4o-mini',
    requiresApiKey: true,
    defaultTier: 'cheap',
    defaultInputCostPer1M: 0.15,
    defaultOutputCostPer1M: 0.60,
    aliases: ['azure-openai'],
  },
  {
    key: 'deepseek',
    providerId: 'provider.deepseek',
    label: 'DeepSeek',
    envPrefix: 'DEEPSEEK',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    requiresApiKey: true,
    defaultTier: 'cheap',
    defaultInputCostPer1M: 0.14,
    defaultOutputCostPer1M: 0.28,
  },
  {
    key: 'avalai',
    providerId: 'provider.avalai',
    label: 'Avalai (Iranian Gateway)',
    envPrefix: 'AVALAI',
    defaultBaseUrl: 'https://api.avalai.ir/v1',
    defaultModel: 'gpt-4o-mini',
    requiresApiKey: true,
    defaultTier: 'cheap',
    defaultInputCostPer1M: 0.15,
    defaultOutputCostPer1M: 0.60,
  },
  {
    key: 'custom',
    providerId: 'provider.custom',
    label: 'Custom / third-party gateway',
    envPrefix: 'CUSTOM',
    // No default: fully user-defined base URL (your own proxy/relay).
    defaultModel: 'gpt-4o-mini',
    requiresApiKey: false,
    defaultTier: 'cheap',
    defaultInputCostPer1M: 0.15,
    defaultOutputCostPer1M: 0.60,
    aliases: ['proxy', 'gateway', 'self-hosted'],
  },
];

const BY_KEY = new Map<string, ProviderPreset>();
for (const preset of PROVIDER_CATALOG) {
  BY_KEY.set(preset.key, preset);
  for (const alias of preset.aliases ?? []) BY_KEY.set(alias, preset);
}

/** Resolve a preset from a `AI_REVIEW_LLM_PROVIDER` value (key or alias). */
export function resolveProviderPreset(value: string | undefined): ProviderPreset | undefined {
  if (!value) return undefined;
  return BY_KEY.get(value.trim().toLowerCase());
}
