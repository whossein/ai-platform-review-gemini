/**
 * Provider-agnostic LLM contracts (ADR-0007).
 *
 * No caller depends on a vendor. Each provider is a thin adapter behind
 * `LLMProvider`. On top sit smart routing and confidence-driven, budget-gated
 * model escalation.
 */

import type { ModelId, ProviderId, PromptId } from './ids.js';
import type { AsyncResult } from './result.js';
import type { Budget } from './budget.js';

/** Coarse capability tiers used by routing/escalation. */
export type ModelTier = 'cheap' | 'mid' | 'premium' | 'local';

/** Capabilities a task may require of a model. */
export type ModelCapability =
  | 'text'
  | 'json_mode'
  | 'tool_use'
  | 'vision'
  | 'long_context'
  | 'prompt_cache';

/** Static description of a model a provider exposes. */
export interface ModelDescriptor {
  readonly id: ModelId;
  readonly provider: ProviderId;
  readonly tier: ModelTier;
  readonly capabilities: readonly ModelCapability[];
  readonly contextWindow: number;
  /** USD per 1M input / output tokens — feeds routing and dollar budgeting. */
  readonly inputCostPer1M: number;
  readonly outputCostPer1M: number;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Tokens served from provider prompt cache, if reported. */
  readonly cachedPromptTokens?: number;
}

/** A single message in a completion request. */
export interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** Marks content eligible for provider-side prompt caching. */
  readonly cacheable?: boolean;
}

export interface LLMRequest {
  readonly model: ModelId;
  readonly messages: readonly LLMMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Request strict JSON output validated against this JSON schema. */
  readonly jsonSchema?: Readonly<Record<string, unknown>>;
  /** For prompt-cache keying and regression tracking. */
  readonly promptId?: PromptId;
}

export interface LLMResponse {
  readonly model: ModelId;
  readonly content: string;
  readonly usage: TokenUsage;
  /** Present when the response was served from the LLM response cache. */
  readonly fromCache?: boolean;
  readonly finishReason: 'stop' | 'length' | 'tool_use' | 'error';
}

/** The single vendor adapter contract. Adding a provider = one implementation. */
export interface LLMProvider {
  readonly id: ProviderId;
  models(): readonly ModelDescriptor[];
  complete(request: LLMRequest): AsyncResult<LLMResponse>;
}

/** Inputs the router uses to pick the cheapest capable model. */
export interface RoutingContext {
  readonly requiredCapabilities: readonly ModelCapability[];
  readonly budget: Budget;
  /** Historical accuracy for the calling agent (0..1), if known. */
  readonly agentAccuracy?: number;
  /** Preferred model declared by the agent, honored when affordable/capable. */
  readonly preferredModel?: ModelId;
}

/**
 * Chooses a model per call. Implementation lives in `llm`; the contract keeps
 * routing policy pluggable and testable.
 */
export interface ModelRouter {
  select(ctx: RoutingContext): AsyncResult<ModelDescriptor>;
}

/**
 * Confidence-driven, budget-gated escalation ladder:
 * cheap → mid → premium. Never escalates unless confidence is below threshold
 * AND budget allows.
 */
export interface EscalationPolicy {
  /** Given the last response's confidence, decide the next model tier (or stop). */
  next(params: {
    readonly currentTier: ModelTier;
    readonly confidence: number;
    readonly confidenceThreshold: number;
    readonly canAffordMore: boolean;
  }): ModelTier | 'stop';
}

/**
 * High-level LLM handle given to agents. It hides routing, escalation, and
 * caching. Agents never see providers or models directly.
 */
export interface LLMClient {
  /** Complete with automatic routing + caching (no escalation loop). */
  complete(request: Omit<LLMRequest, 'model'> & { model?: ModelId }): AsyncResult<LLMResponse>;
}
