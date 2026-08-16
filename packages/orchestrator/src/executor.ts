/**
 * Review stage executor (ADR-0005).
 *
 * Implements StageExecutor for the workflow engine. Executes each review stage:
 * rules → specialist agents (via AgentRuntime ONLY) → critic → judge → reporting.
 */

import type {
  AdjudicatedIssue,
  AgentExecutionContext,
  AgentId,
  AsyncResult,
  BudgetGuard,
  ContextSlice,
  Issue,
  LLMClient,
  ReviewMetrics,
  ReviewId,
  WorkflowStage,
} from '@ai-review/core';
import type { DefaultAgentRuntime } from '@ai-review/agent-runtime';
import type { StageExecutor, StageOutcome } from '@ai-review/workflow-engine';
import {
  DefaultRuleEngine,
  MapRuleRegistry,
  DEFAULT_RULES,
  ruleFindingToIssue,
  type FileRuleContext,
} from '@ai-review/config';
import { MarkdownReporter, JsonReporter } from '@ai-review/reporting';
import type { ReservableBudgetGuard } from './budget.js';
import { isTransientError } from './budget.js';
import { critique } from './critic.js';

export interface ModelPricing {
  readonly inputCostPer1M: number;
  readonly outputCostPer1M: number;
}

export interface ReviewExecutionContext {
  readonly diff: string;
  readonly files?: readonly { path: string; text: string }[] | undefined;
  readonly slice: ContextSlice;
  readonly baseCtx: AgentExecutionContext;
  readonly runtime: DefaultAgentRuntime;
  readonly reservableGuard: ReservableBudgetGuard;
  readonly pricing: ReadonlyMap<string, ModelPricing>;
  readonly threshold: number;
  readonly maxAgentRetries?: number | undefined;
  readonly startedAt: number;

  // Mutable accumulators populated across stages
  readonly deterministicIssues: Issue[];
  readonly allIssues: Issue[];
  readonly agentMetrics: Array<ReviewMetrics['agents'][number]>;
  readonly agentErrors: Array<{ agentId: string; message: string }>;
  consolidatedIssues: Issue[];
  adjudicatedIssues: AdjudicatedIssue[];
  markdownReport: string;
  jsonReport: string;
}

const SEVERITY_WEIGHT: Record<Issue['severity'], number> = {
  critical: 1.0,
  high: 0.8,
  medium: 0.5,
  low: 0.3,
  info: 0.1,
};

export function adjudicate(issues: readonly Issue[], threshold: number): AdjudicatedIssue[] {
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

export class ReviewStageExecutor implements StageExecutor {
  constructor(private readonly ctx: ReviewExecutionContext) {}

  async execute(stage: WorkflowStage, _budget: BudgetGuard): AsyncResult<StageOutcome> {
    try {
      switch (stage.kind) {
        case 'rules':
          return await this.executeRules();
        case 'agent':
          return await this.executeAgent(stage);
        case 'critic':
          return await this.executeCritic();
        case 'judge':
          return await this.executeJudge();
        case 'reporting':
          return await this.executeReporting();
        default:
          return { ok: true, value: { kind: 'completed' } };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: true, value: { kind: 'failed', reason } };
    }
  }

  private async executeRules(): AsyncResult<StageOutcome> {
    const filesToScan: { path: string; text: string }[] = [];
    if (this.ctx.files && this.ctx.files.length > 0) {
      filesToScan.push(...this.ctx.files);
    } else if (this.ctx.slice && this.ctx.slice.files && this.ctx.slice.files.length > 0) {
      for (const f of this.ctx.slice.files) {
        filesToScan.push({ path: f.path, text: this.ctx.slice.rendered ?? '' });
      }
    }

    if (filesToScan.length > 0) {
      const ruleRegistry = new MapRuleRegistry();
      for (const rule of DEFAULT_RULES) ruleRegistry.register(rule);
      const ruleEngine = new DefaultRuleEngine(ruleRegistry);
      const ruleCtx: FileRuleContext = {
        repositoryId: 'repo.local',
        files: filesToScan,
      };
      const ruleRes = await ruleEngine.run(ruleCtx);
      if (ruleRes.ok) {
        for (const finding of ruleRes.value.findings) {
          const issue = ruleFindingToIssue(finding);
          this.ctx.deterministicIssues.push(issue);
          this.ctx.allIssues.push(issue);
        }
      }
    }
    return { ok: true, value: { kind: 'completed' } };
  }

  private async executeAgent(stage: WorkflowStage): AsyncResult<StageOutcome> {
    const agentId = (stage.agentId ?? stage.id) as AgentId;

    // Estimate cost based on diff/slice size + expected completion
    const estimatedTokens = Math.max(1000, this.ctx.slice.estimatedTokens + 800);
    const estimatedDollars = (estimatedTokens / 1_000_000) * 2.0; // conservative estimate

    // Pre-execution budget reservation
    const reservation = this.ctx.reservableGuard.reserve({
      tokens: estimatedTokens,
      dollars: estimatedDollars,
    });

    if (!reservation.ok) {
      // Budget cannot afford this agent; skip gracefully
      this.ctx.agentErrors.push({
        agentId,
        message: `Budget reservation denied: ${reservation.reason}`,
      });
      this.ctx.agentMetrics.push({
        agentId,
        executionMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        cacheHits: 0,
        cacheMisses: 0,
      });
      return { ok: true, value: { kind: 'completed' } };
    }

    const reservationId = reservation.reservationId;
    const agentStart = Date.now();

    // Agent execution context routed STRICTLY through AgentRuntime
    const agentLlm: LLMClient = {
      complete: (req) => this.ctx.baseCtx.llm.complete(req),
    };

    const execResult = await this.ctx.runtime.execute(agentId, {
      ...this.ctx.baseCtx,
      llm: agentLlm,
    });

    const executionMs = Date.now() - agentStart;

    if (execResult.ok) {
      const value = execResult.value;
      const promptTokens = value.usage?.promptTokens ?? 0;
      const completionTokens = value.usage?.completionTokens ?? 0;
      const totalTokens = promptTokens + completionTokens;

      const price = value.model ? this.ctx.pricing.get(value.model) : undefined;
      const costUsd = price
        ? (promptTokens / 1_000_000) * price.inputCostPer1M +
          (completionTokens / 1_000_000) * price.outputCostPer1M
        : 0;

      // Post-execution reconciliation
      this.ctx.reservableGuard.reconcile(reservationId, {
        tokensUsed: totalTokens,
        dollarsSpent: costUsd,
      });

      this.ctx.allIssues.push(...value.issues);
      this.ctx.agentMetrics.push({
        agentId,
        executionMs,
        promptTokens,
        completionTokens,
        costUsd,
        cacheHits: 0,
        cacheMisses: 0,
      });

      return { ok: true, value: { kind: 'completed' } };
    }

    // Release reservation on failure
    this.ctx.reservableGuard.release(reservationId);

    const error = execResult.error;
    const retryable = isTransientError(error);

    if (retryable) {
      return { ok: true, value: { kind: 'retryable', reason: error.message } };
    }

    // Permanent agent failure: record error and complete stage gracefully so remaining review continues
    this.ctx.agentErrors.push({ agentId, message: error.message });
    this.ctx.agentMetrics.push({
      agentId,
      executionMs,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      cacheHits: 0,
      cacheMisses: 0,
    });

    return { ok: true, value: { kind: 'completed' } };
  }

  private async executeCritic(): AsyncResult<StageOutcome> {
    this.ctx.consolidatedIssues = critique(this.ctx.allIssues);
    return { ok: true, value: { kind: 'completed' } };
  }

  private async executeJudge(): AsyncResult<StageOutcome> {
    this.ctx.adjudicatedIssues = adjudicate(this.ctx.consolidatedIssues, this.ctx.threshold);
    return { ok: true, value: { kind: 'completed' } };
  }

  private async executeReporting(): AsyncResult<StageOutcome> {
    const accepted = this.ctx.adjudicatedIssues.filter((i) => i.accepted);
    const failureNote =
      this.ctx.agentErrors.length > 0
        ? ` (${this.ctx.agentErrors.length} agent(s) failed: ${this.ctx.agentErrors.map((e) => `${e.agentId} — ${e.message}`).join('; ')})`
        : '';
    const summary =
      accepted.length === 0
        ? `No issues met the publish threshold.${failureNote}`
        : `${accepted.length} issue(s) across ${new Set(accepted.map((i) => i.category)).size} categor(ies).${failureNote}`;

    const metrics: ReviewMetrics = {
      reviewId: this.ctx.baseCtx.reviewId as ReviewId,
      totalExecutionMs: Date.now() - this.ctx.startedAt,
      totalPromptTokens: this.ctx.agentMetrics.reduce((sum, a) => sum + a.promptTokens, 0),
      totalCompletionTokens: this.ctx.agentMetrics.reduce((sum, a) => sum + a.completionTokens, 0),
      totalCostUsd: this.ctx.agentMetrics.reduce((sum, a) => sum + a.costUsd, 0),
      cacheHits: 0,
      cacheMisses: 0,
      agents: this.ctx.agentMetrics,
    };

    const reportInput = {
      issues: this.ctx.adjudicatedIssues,
      metrics,
      summary,
    };

    const md = await new MarkdownReporter().render(reportInput);
    const json = await new JsonReporter().render(reportInput);

    this.ctx.markdownReport = md.ok ? md.value.content : '(failed to render markdown)';
    this.ctx.jsonReport = json.ok ? json.value.content : '{}';

    return { ok: true, value: { kind: 'completed' } };
  }
}
