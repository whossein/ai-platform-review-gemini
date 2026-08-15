/**
 * Agent contracts (ADR-0003).
 *
 * Agents are declarative data + a contract, never hardcoded classes. The runtime
 * registers them dynamically and hands each a scoped execution context.
 */

import type { AgentId, ModelId, SkillId, ToolId } from './ids.js';
import type { AsyncResult } from './result.js';
import type { MemoryScope, MemoryHandle } from './memory.js';
import type { Issue } from './issue.js';
import type { LLMClient, TokenUsage } from './llm.js';
import type { ContextEngine, ContextSlice } from './context.js';
import type { SkillAccessor } from './skill.js';
import type { ToolAccessor } from './tool.js';
import type { BudgetGuard } from './budget.js';

/**
 * The declarative definition every agent must provide. This metadata powers
 * routing, budgeting, capability gating, and the trust pipeline.
 */
export interface AgentDefinition {
  readonly id: AgentId;
  readonly name: string;
  readonly goal: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly allowedTools: readonly ToolId[];
  readonly allowedSkills: readonly SkillId[];
  /** JSON schema the agent's output is validated against. */
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly memoryScope: MemoryScope;
  /** Higher runs earlier when ordering matters; ties run in parallel. */
  readonly priority: number;
  /** Below this confidence, escalation may be triggered (0..1). */
  readonly confidenceThreshold: number;
  readonly preferredModel?: ModelId;
  readonly temperature: number;
}

/** Everything an agent may touch during execution — all capability-gated. */
export interface AgentExecutionContext {
  readonly reviewId: string;
  /** Slice-only access; agents cannot trigger a context rebuild. */
  readonly context: Pick<ContextEngine, 'slice'>;
  readonly skills: SkillAccessor;
  readonly tools: ToolAccessor;
  readonly memory: MemoryHandle;
  readonly llm: LLMClient;
  readonly budget: BudgetGuard;
  /** Deterministic rule findings + prior context slice provided by the runtime. */
  readonly seedSlice?: ContextSlice;
}

/** Structured result an agent returns; validated against `outputSchema`. */
export interface AgentResult {
  readonly agentId: AgentId;
  readonly issues: readonly Issue[];
  /** Aggregate confidence for the agent's run (0..1). */
  readonly confidence: number;
  /** Optional short, structured summary (never free-form prose reporting). */
  readonly summary?: string;
  /** Real token usage for the LLM call(s) this agent made, when applicable. */
  readonly usage?: TokenUsage;
  /** The model id the underlying LLM call used, for cost lookup/telemetry. */
  readonly model?: ModelId;
}

/**
 * Optional code handler. Agents may be purely declarative (prompt-driven) or
 * provide a handler for specialized reasoning. Both live behind one contract.
 */
export interface AgentHandler {
  run(ctx: AgentExecutionContext): AsyncResult<AgentResult>;
}

/** A registered agent = its definition plus an optional handler. */
export interface RegisteredAgent {
  readonly definition: AgentDefinition;
  readonly handler?: AgentHandler;
}

/** Dynamic registry populated at boot by first-party code and plugins. */
export interface AgentRegistry {
  register(agent: RegisteredAgent): void;
  get(id: AgentId): RegisteredAgent | undefined;
  list(): readonly AgentDefinition[];
}

/** Executes a registered agent within budget, validating its output. */
export interface AgentRuntime {
  execute(id: AgentId, ctx: AgentExecutionContext): AsyncResult<AgentResult>;
}
