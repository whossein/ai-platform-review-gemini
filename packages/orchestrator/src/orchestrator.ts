/**
 * Review orchestrator (composition root).
 *
 * Wires the vertical slice end-to-end without any external services:
 *   diff → shared context slice (built once) → specialist agents (parallel,
 *   via the runtime) → Judge (accept above confidence) → Markdown/JSON report.
 *
 * This is deliberately small and explicit. As phases land, the hand-rolled
 * pieces here (context slice, judge, budget guard) are replaced by the real
 * context-engine, critic/judge agents, and workflow-engine wiring — without
 * changing the contracts consumed below.
 */

import type {
  AdjudicatedIssue,
  AgentExecutionContext,
  AgentId,
  Budget,
  BudgetGuard,
  BudgetStatus,
  ContextSlice,
  Issue,
  LLMClient,
  MemoryHandle,
  ReviewMetrics,
  ReviewId,
} from '@ai-review/core';
import { MapAgentRegistry, DefaultAgentRuntime } from '@ai-review/agent-runtime';
import { DefaultContextEngine, type SourceFile } from '@ai-review/context-engine';
import {
  DefaultRuleEngine,
  MapRuleRegistry,
  DEFAULT_RULES,
  ruleFindingToIssue,
  type FileRuleContext,
} from '@ai-review/config';
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

import { MarkdownReporter, JsonReporter } from '@ai-review/reporting';
import { SPECIALISTS, makeSpecialistDefinition, makeSpecialistHandler } from './agents.js';
import { plan, type ReviewPlan } from './planner.js';
import { critique } from './critic.js';

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

/** A budget guard that tallies real usage and flips `exceeded` when overspent. */
function makeBudgetGuard(budget: Budget): BudgetGuard {
  const usage = { tokensUsed: 0, dollarsSpent: 0, elapsedMs: 0 };
  const started = Date.now();
  const build = (): BudgetStatus => {
    const elapsedMs = Date.now() - started;
    const exceeded: Array<'token' | 'dollar' | 'execution'> = [];
    if (usage.tokensUsed > budget.tokenBudget) exceeded.push('token');
    if (usage.dollarsSpent > budget.dollarBudget) exceeded.push('dollar');
    if (elapsedMs > budget.executionBudgetMs) exceeded.push('execution');

    return {
      budget,
      usage: { ...usage, elapsedMs },
      remainingTokens: budget.tokenBudget - usage.tokensUsed,
      remainingDollars: budget.dollarBudget - usage.dollarsSpent,
      remainingMs: budget.executionBudgetMs - elapsedMs,
      exceeded,
    };
  };
  return {
    status: build,
    record: (delta) => {
      usage.tokensUsed += delta.tokensUsed ?? 0;
      usage.dollarsSpent += delta.dollarsSpent ?? 0;
      return build();
    },
    canAfford: () => build().exceeded.length === 0,
  };
}

/**
 * The Judge: accept a finding when its confidence clears the threshold. Rank by
 * severity × confidence so the report leads with what matters. A real Judge agent
 * would also reconcile against the false-positive DB and prior snapshots.
 */
const SEVERITY_WEIGHT: Record<Issue['severity'], number> = {
  critical: 1.0,
  high: 0.8,
  medium: 0.5,
  low: 0.3,
  info: 0.1,
};

function adjudicate(issues: readonly Issue[], threshold: number): AdjudicatedIssue[] {
  return issues.map((issue) => {
    const accepted = issue.confidence >= threshold;
    return {
      ...issue,
      accepted,
      adjudicationReason: accepted
        ? `confidence ${(issue.confidence * 100).toFixed(0)}% ≥ threshold`
        : `confidence ${(issue.confidence * 100).toFixed(0)}% below threshold`,
      rankScore: SEVERITY_WEIGHT[issue.severity] * issue.confidence,
    };
  });
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
}

export async function runReview(opts: RunOptions): Promise<ReviewResult> {
  const reviewId = (opts.reviewId ?? 'review.local') as ReviewId;
  const threshold = opts.confidenceThreshold ?? 0.6;
  const budget: Budget = opts.budget ?? {
    tokenBudget: 200_000,
    dollarBudget: 1,
    executionBudgetMs: 120_000,
  };

  // LLM layer (ADR-0007): prefer a REAL provider when configured via env
  // (AI_REVIEW_LLM_* — works with OpenAI, OpenRouter, Ollama, DeepSeek, Azure),
  // otherwise fall back to the zero-cost offline mock so the pipeline always
  // runs. Either way the router/escalation/agents are identical.
  const realProviders = providersFromEnv(opts.env ?? process.env);
  const providers = realProviders.length > 0 ? realProviders : [new MockLLMProvider()];
  const router = new CheapestFirstRouter(providers);
  const routing: LLMClient = new RoutingLLMClient(providers, router, {
    requiredCapabilities: realProviders.length > 0 ? ['text'] : ['text', 'json_mode'],
    budget,
  });
  // LLM RESPONSE CACHE (ADR-0007, the #1 token/$ lever): memoize identical
  // completions so duplicate calls across agents, retries, and re-runs never
  // cost twice. A hit returns zero tokens. The cache instance is per-review
  // here; a shared/persistent backend implements the same `Cache` contract.
  const llmCache = new CachingLLMClient(routing, new InMemoryCache<LLMResponse>('llm_response'));
  const llm: LLMClient = opts.llm ?? llmCache;

  // The agent registry is populated *after* the Planner decides which
  // specialists are relevant (see below), so we only ever register — and pay
  // for — the agents this specific change needs (ADR-0003).
  const registry = new MapAgentRegistry();
  const runtime = new DefaultAgentRuntime(registry);

  // Context Engine: build shared context ONCE (ADR-0004) via real AST
  // extraction, then serve a single minimal slice shared across all agents.
  // The slice pairs the raw diff (what changed) with the engine's structural
  // summary (imports/exports/symbols, changed-symbol markers) so specialists
  // reason over structure without any agent triggering a rebuild.
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
    // Degrade gracefully to the raw diff if context construction fails.
    slice = {
      handle: 'ctx.local' as ContextSlice['handle'],
      version: 1,
      files: [],
      rendered: opts.diff,
      estimatedTokens: Math.ceil(opts.diff.length / 4),
      compressed: false,
    };
  }

  const guard = makeBudgetGuard(budget);
  // Real multi-scope memory; agents get a handle confined to the review scope.
  const memoryStore = new InMemoryMemoryStore();
  const memory: MemoryHandle = memoryStore.bindScope('review');

  const baseCtx: Omit<AgentExecutionContext, never> = {
    reviewId,
    context: {
      slice: async () => ({ ok: true, value: slice }),
    },
    tools: { invoke: async () => ({ ok: true, value: { output: {} } }), available: () => [] },
    skills: { execute: async () => ({ ok: true, value: { result: {} } }), available: () => [] },
    memory,
    llm,
    budget: guard,
    seedSlice: slice,
  };

  // DETERMINISTIC FIRST (ADR-0006, the #1 cost lever): run free, precise rules
  // before any LLM call. Their findings (confidence 1.0) join the same judge/
  // report path, and `coveredConcerns` could later let the Planner skip
  // redundant specialists. Only runs when we have full file texts to scan.
  const started = Date.now();
  const deterministicIssues: Issue[] = [];
  if (opts.files && opts.files.length > 0) {
    const ruleRegistry = new MapRuleRegistry();
    for (const rule of DEFAULT_RULES) ruleRegistry.register(rule);
    const ruleEngine = new DefaultRuleEngine(ruleRegistry);
    const ruleCtx: FileRuleContext = {
      repositoryId: 'repo.local',
      files: opts.files.map((f) => ({ path: f.path, text: f.text })),
    };
    const ruleRes = await ruleEngine.run(ruleCtx);
    if (ruleRes.ok) {
      for (const finding of ruleRes.value.findings) {
        deterministicIssues.push(ruleFindingToIssue(finding));
      }
    }
  }

  // PLANNER / SMART ROUTING (ADR-0003, token lever #2): pick only the specialists
  // this change can benefit from, and skip any whose category was already fully
  // handled by the deterministic rules. We register just those agents, so the
  // runtime only spends tokens where the Planner decided it is worthwhile.
  const coveredCategories = [...new Set(deterministicIssues.map((i) => i.category))];
  const reviewPlan: ReviewPlan = plan({
    diff: opts.diff,
    specialists: SPECIALISTS,
    coveredCategories,
  });
  
  const specsToRun = opts.selectedSpecialists
    ? SPECIALISTS.filter(s => opts.selectedSpecialists?.includes(s.name))
    : reviewPlan.selected;

  for (const spec of specsToRun) {
    registry.register({
      definition: makeSpecialistDefinition(spec, opts.env),
      handler: makeSpecialistHandler(spec, opts.env),
    });
  }

  // Run the selected specialists in parallel through the runtime (each is
  // capability-gated and output-validated). Aggregate their issues + token usage.
  const definitions = registry.list();

  const results = await Promise.allSettled(
    definitions.map((def) => {
      const agentLlm: LLMClient = {
        complete: (req) =>
          baseCtx.llm.complete({
            ...req,
            ...(def.preferredModel && !req.model ? { model: def.preferredModel } : {}),
            ...(def.preferredTier && !req.preferredTier ? { preferredTier: def.preferredTier } : {}),
          }),
      };
      return runtime.execute(def.id as AgentId, { ...baseCtx, llm: agentLlm });
    }),
  );

  // Deterministic findings lead the pool — they are free and trustworthy.
  const allIssues: Issue[] = [...deterministicIssues];
  const agentMetrics: Array<ReviewMetrics['agents'][number]> = [];
  const agentErrors: Array<{ agentId: string; message: string }> = [];

  // Price lookup so real token usage can be turned into a real dollar cost —
  // keyed by model id across every registered provider (mock providers cost 0).
  const pricing = new Map<string, { inputCostPer1M: number; outputCostPer1M: number }>();
  for (const provider of providers) {
    for (const m of provider.models()) {
      pricing.set(m.id, { inputCostPer1M: m.inputCostPer1M, outputCostPer1M: m.outputCostPer1M });
    }
  }

  for (let i = 0; i < results.length; i++) {
    const settled = results[i]!;
    const def = definitions[i]!;

    if (settled.status === 'rejected') {
      // ponytail: no retry queue yet; add durable per-agent checkpoints when reviews become long-running jobs.
      agentErrors.push({
        agentId: def.id,
        message: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
      });
      agentMetrics.push({
        agentId: def.id as AgentId,
        executionMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        cacheHits: 0,
        cacheMisses: 0,
      });
      continue;
    }

    const res = settled.value;
    if (res.ok) {
      allIssues.push(...res.value.issues);
      const usage = res.value.usage;
      const promptTokens = usage?.promptTokens ?? 0;
      const completionTokens = usage?.completionTokens ?? 0;
      const price = res.value.model ? pricing.get(res.value.model) : undefined;
      const costUsd = price
        ? (promptTokens / 1_000_000) * price.inputCostPer1M +
          (completionTokens / 1_000_000) * price.outputCostPer1M
        : 0;
      guard.record({ tokensUsed: promptTokens + completionTokens, dollarsSpent: costUsd });
      agentMetrics.push({
        agentId: def.id as AgentId,
        executionMs: 0,
        promptTokens,
        completionTokens,
        costUsd,
        cacheHits: 0,
        cacheMisses: 0,
      });
    } else {
      // Never swallow this: a failed agent is the #1 reason a review comes
      // back with zero issues even though real problems exist in the diff.
      agentErrors.push({ agentId: def.id, message: res.error.message });
      agentMetrics.push({
        agentId: def.id as AgentId,
        executionMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        cacheHits: 0,
        cacheMisses: 0,
      });
    }
  }

  // CRITIC (review flow: consolidation before the Judge): merge findings that
  // multiple agents reported for the same defect, boosting confidence when
  // reviewers independently corroborate one another. This de-duplicates the
  // report and strengthens the signal the Judge adjudicates on.
  const consolidated = critique(allIssues);

  const adjudicated = adjudicate(consolidated, threshold);
  const accepted = adjudicated.filter((i) => i.accepted);

  const metrics: ReviewMetrics = {
    reviewId,
    totalExecutionMs: Date.now() - started,
    totalPromptTokens: agentMetrics.reduce((sum, a) => sum + a.promptTokens, 0),
    totalCompletionTokens: agentMetrics.reduce((sum, a) => sum + a.completionTokens, 0),
    totalCostUsd: agentMetrics.reduce((sum, a) => sum + a.costUsd, 0),
    // Real LLM-response-cache accounting from the caching client (ADR-0007).
    cacheHits: opts.llm ? 0 : llmCache.hits,
    cacheMisses: opts.llm ? 0 : llmCache.misses,
    agents: agentMetrics,
  };

  const failureNote =
    agentErrors.length > 0
      ? ` (${agentErrors.length} agent(s) failed: ${agentErrors.map((e) => `${e.agentId} — ${e.message}`).join('; ')})`
      : '';
  const summary =
    accepted.length === 0
      ? `No issues met the publish threshold.${failureNote}`
      : `${accepted.length} issue(s) across ${new Set(accepted.map((i) => i.category)).size} categor(ies).${failureNote}`;

  const reportInput = { issues: adjudicated, metrics, summary };
  const md = await new MarkdownReporter().render(reportInput);
  const json = await new JsonReporter().render(reportInput);

  return {
    markdown: md.ok ? md.value.content : '(failed to render markdown)',
    json: json.ok ? json.value.content : '{}',
    accepted: accepted.length,
    total: adjudicated.length,
    metrics,
    issues: adjudicated,
    errors: agentErrors,
  };
}
