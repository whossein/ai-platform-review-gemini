/**
 * Review orchestrator (composition root).
 *
 * Integrates the full review lifecycle via DagWorkflowEngine:
 *   diff → shared context slice (built once) → deterministic rules →
 *   smart routing → specialist agents (executed STRICTLY via AgentRuntime in parallel) →
 *   Critic (consolidation) → Judge (adjudication) → Markdown/JSON reporting.
 */

import type {
  AdjudicatedIssue,
  AgentExecutionContext,
  AgentId,
  Budget,
  ContextSlice,
  LLMClient,
  MemoryHandle,
  ReviewMetrics,
  ReviewId,
  StageId,
  WorkflowDefinition,
  WorkflowStage,
} from '@ai-review/core';
import { MapAgentRegistry, DefaultAgentRuntime } from '@ai-review/agent-runtime';
import { DefaultContextEngine, type SourceFile } from '@ai-review/context-engine';
import {
  MockLLMProvider,
  providersFromEnv,
  CheapestFirstRouter,
  RoutingLLMClient,
  CachingLLMClient,
} from '@ai-review/llm';
import { InMemoryMemoryStore } from '@ai-review/memory';
import { InMemoryCache } from '@ai-review/shared';
import type { LLMResponse } from '@ai-review/core';
import { DagWorkflowEngine } from '@ai-review/workflow-engine';

import { SPECIALISTS, makeSpecialistDefinition, makeSpecialistHandler } from './agents.js';
import { plan, type ReviewPlan } from './planner.js';
import { ReservableBudgetGuard } from './budget.js';
import {
  ReviewStageExecutor,
  type ReviewExecutionContext,
  type ModelPricing,
  adjudicate,
} from './executor.js';

export interface ReviewResult {
  readonly markdown: string;
  readonly json: string;
  readonly accepted: number;
  readonly total: number;
  readonly metrics: ReviewMetrics;
  /** All adjudicated issues (accepted + rejected), ranked — for publishing. */
  readonly issues: readonly AdjudicatedIssue[];
  /**
   * Specialists that failed to produce a result (LLM error, bad JSON, budget
   * exhaustion, …). Never silently swallowed — callers should surface these,
   * since they are the most common reason a review reports zero issues.
   */
  readonly errors: readonly { readonly agentId: string; readonly message: string }[];
}

export interface RunOptions {
  readonly diff: string;
  readonly reviewId?: string;
  readonly confidenceThreshold?: number;
  readonly budget?: Budget;
  /** Optional full file texts (e.g. from a local folder) for richer context. */
  readonly files?: readonly SourceFile[];
  /** Test/embedding seam: override the LLM client without touching env. */
  readonly llm?: LLMClient;
  /** Optional env overrides for the LLM provider. */
  readonly env?: Record<string, string>;
  /** Optional explicit list of specialist names to run. If provided, overrides the planner. */
  readonly selectedSpecialists?: readonly string[];
  /** Optional max retries per agent stage on transient errors (default: 2). */
  readonly maxRetries?: number;
}

export async function runReview(opts: RunOptions): Promise<ReviewResult> {
  const reviewId = (opts.reviewId ?? 'review.local') as ReviewId;
  const threshold = opts.confidenceThreshold ?? 0.6;
  const budget: Budget = opts.budget ?? {
    tokenBudget: 200_000,
    dollarBudget: 1,
    executionBudgetMs: 120_000,
  };
  const maxRetries = opts.maxRetries ?? 2;
  const started = Date.now();

  // LLM layer (ADR-0007): prefer a REAL provider when configured via env,
  // otherwise fall back to the zero-cost offline mock so the pipeline always runs.
  const realProviders = providersFromEnv(opts.env ?? process.env);
  const providers = realProviders.length > 0 ? realProviders : [new MockLLMProvider()];
  const router = new CheapestFirstRouter(providers);
  const routing: LLMClient = new RoutingLLMClient(providers, router, {
    requiredCapabilities: realProviders.length > 0 ? ['text'] : ['text', 'json_mode'],
    budget,
  });

  // LLM RESPONSE CACHE (ADR-0007)
  const llmCache = new CachingLLMClient(routing, new InMemoryCache<LLMResponse>('llm_response'));
  const llm: LLMClient = opts.llm ?? llmCache;

  // Context Engine: build shared context ONCE (ADR-0004)
  const contextEngine = new DefaultContextEngine();
  const built = await contextEngine.build({
    repositoryId: 'repo.local' as never,
    diff: opts.diff,
    ...(opts.files ? { files: opts.files } : {}),
  });

  let slice: ContextSlice;
  if (built.ok) {
    const sliceRes = await contextEngine.slice({
      handle: built.value.handle,
      tokenBudget: budget.tokenBudget,
    });
    const structural = sliceRes.ok ? sliceRes.value.rendered : '';
    const rendered = `${opts.diff}\n\n--- context ---\n${structural}`;
    slice = {
      handle: built.value.handle,
      version: built.value.version,
      files: sliceRes.ok ? sliceRes.value.files : [],
      rendered,
      estimatedTokens: Math.ceil(rendered.length / 4),
      compressed: sliceRes.ok ? sliceRes.value.compressed : false,
    };
  } else {
    slice = {
      handle: 'ctx.local' as ContextSlice['handle'],
      version: 1,
      files: [],
      rendered: opts.diff,
      estimatedTokens: Math.ceil(opts.diff.length / 4),
      compressed: false,
    };
  }

  // Reservable budget guard: enforces atomic pre-execution reservations
  const reservableGuard = new ReservableBudgetGuard(budget);

  // Scoped memory
  const memoryStore = new InMemoryMemoryStore();
  const memory: MemoryHandle = memoryStore.bindScope('review');

  // Agent registry & runtime
  const registry = new MapAgentRegistry();
  const runtime = new DefaultAgentRuntime(registry);

  // Pricing table for models
  const pricing = new Map<string, ModelPricing>();
  for (const provider of providers) {
    for (const m of provider.models()) {
      pricing.set(m.id, { inputCostPer1M: m.inputCostPer1M, outputCostPer1M: m.outputCostPer1M });
    }
  }

  // Base execution context passed into agents through AgentRuntime
  const baseCtx: AgentExecutionContext = {
    reviewId,
    context: {
      slice: async () => ({ ok: true, value: slice }),
    },
    tools: { invoke: async () => ({ ok: true, value: { output: {} } }), available: () => [] },
    skills: { execute: async () => ({ ok: true, value: { result: {} } }), available: () => [] },
    memory,
    llm,
    budget: reservableGuard,
    seedSlice: slice,
  };

  // Plan smart routing for specialists
  const reviewPlan: ReviewPlan = plan({
    diff: opts.diff,
    specialists: SPECIALISTS,
  });

  const specsToRun = opts.selectedSpecialists
    ? SPECIALISTS.filter((s) => opts.selectedSpecialists?.includes(s.name))
    : reviewPlan.selected;

  // Register only the selected specialists
  for (const spec of specsToRun) {
    registry.register({
      definition: makeSpecialistDefinition(spec, opts.env),
      handler: makeSpecialistHandler(spec, opts.env),
    });
  }

  // Construct ReviewExecutionContext
  const reviewCtx: ReviewExecutionContext = {
    diff: opts.diff,
    files: opts.files,
    slice,
    baseCtx,
    runtime,
    reservableGuard,
    pricing,
    threshold,
    maxAgentRetries: maxRetries,
    startedAt: started,
    deterministicIssues: [],
    allIssues: [],
    agentMetrics: [],
    agentErrors: [],
    consolidatedIssues: [],
    adjudicatedIssues: [],
    markdownReport: '',
    jsonReport: '',
  };

  const executor = new ReviewStageExecutor(reviewCtx);

  // Build DAG Stages for the WorkflowEngine
  const stages: WorkflowStage[] = [];

  // Stage 1: Deterministic Rules
  const rulesStageId = 'stage.rules' as StageId;
  stages.push({
    id: rulesStageId,
    kind: 'rules',
    dependsOn: [],
  });

  // Stage 2: Specialist Agent Stages (run in parallel)
  const agentStageIds: StageId[] = [];
  for (const spec of specsToRun) {
    const stageId = `agent.${spec.id}` as StageId;
    agentStageIds.push(stageId);
    stages.push({
      id: stageId,
      kind: 'agent',
      agentId: spec.id as AgentId,
      dependsOn: [rulesStageId],
      parallelGroup: 'specialists',
      maxRetries,
    });
  }

  // Stage 3: Critic (consolidation) - depends on rules and all specialists
  const criticStageId = 'stage.critic' as StageId;
  stages.push({
    id: criticStageId,
    kind: 'critic',
    dependsOn: [rulesStageId, ...agentStageIds],
  });

  // Stage 4: Judge (adjudication)
  const judgeStageId = 'stage.judge' as StageId;
  stages.push({
    id: judgeStageId,
    kind: 'judge',
    dependsOn: [criticStageId],
  });

  // Stage 5: Reporting (render output)
  const reportingStageId = 'stage.reporting' as StageId;
  stages.push({
    id: reportingStageId,
    kind: 'reporting',
    dependsOn: [judgeStageId],
  });

  const workflowDefinition: WorkflowDefinition = {
    id: `wf.review.${reviewId}` as never,
    name: 'Standard Code Review',
    description: 'Declarative DAG orchestration of review stages',
    stages,
  };

  // Run the review via DagWorkflowEngine
  const engine = new DagWorkflowEngine(executor, () => reservableGuard);
  await engine.run(workflowDefinition, budget);

  // If reporting stage did not populate reports (e.g. total failure), ensure fallback reports
  if (!reviewCtx.adjudicatedIssues.length && reviewCtx.allIssues.length) {
    reviewCtx.adjudicatedIssues = adjudicate(reviewCtx.allIssues, threshold);
  }

  const accepted = reviewCtx.adjudicatedIssues.filter((i) => i.accepted);

  const metrics: ReviewMetrics = {
    reviewId,
    totalExecutionMs: Date.now() - started,
    totalPromptTokens: reviewCtx.agentMetrics.reduce((sum, a) => sum + a.promptTokens, 0),
    totalCompletionTokens: reviewCtx.agentMetrics.reduce((sum, a) => sum + a.completionTokens, 0),
    totalCostUsd: reviewCtx.agentMetrics.reduce((sum, a) => sum + a.costUsd, 0),
    cacheHits: opts.llm ? 0 : llmCache.hits,
    cacheMisses: opts.llm ? 0 : llmCache.misses,
    agents: reviewCtx.agentMetrics,
  };

  return {
    markdown: reviewCtx.markdownReport || '(no report generated)',
    json: reviewCtx.jsonReport || '{}',
    accepted: accepted.length,
    total: reviewCtx.adjudicatedIssues.length,
    metrics,
    issues: reviewCtx.adjudicatedIssues,
    errors: reviewCtx.agentErrors,
  };
}

export { makeBudgetGuard } from './budget.js';
export { adjudicate } from './executor.js';
