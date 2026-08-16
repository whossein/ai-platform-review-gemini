/**
 * @ai-review/llm
 *
 * Provider-agnostic LLM layer (ADR-0007):
 *  - `MockLLMProvider`     — offline, deterministic, zero-cost provider for
 *                            local dev/tests/demos (no API key required).
 *  - `CheapestFirstRouter` — selects the cheapest capable model.
 *  - `RoutingLLMClient`    — the high-level handle agents use; hides models.
 *
 * Real providers (Claude/OpenAI/Gemini/Ollama/…) implement `LLMProvider` and
 * drop in without changing any caller.
 */

export { MockLLMProvider } from './mock-provider.js';
export {
  OpenAICompatibleProvider,
  providerFromEnv,
  providersFromEnv,
  type OpenAICompatibleOptions,
  type OpenAICompatibleModel,
} from './openai-provider.js';
export { CheapestFirstRouter, RoutingLLMClient } from './client.js';
export { CachingLLMClient, llmRequestKey } from './cache.js';
export {
  PROVIDER_CATALOG,
  resolveProviderPreset,
  type ProviderKey,
  type ProviderPreset,
} from './provider-catalog.js';
