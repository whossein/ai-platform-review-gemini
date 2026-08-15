/**
 * Workflow engine (ADR-0005).
 *
 * Schedules a declarative DAG of stages:
 *   1. validation        — reject unknown deps and cycles before running;
 *   2. topological order  — a stage starts only once its deps have completed;
 *   3. parallelism        — ready stages in the same `parallelGroup` run together;
 *   4. retries            — transient stage failures retry up to `maxRetries`;
 *   5. graceful degrade   — when the budget is exhausted, remaining non-terminal
 *                           stages are skipped and the run ends `degraded` rather
 *                           than hard-failing (ADR-0005 / ARCHITECTURE §13).
 *
 * How a stage actually *does its work* is delegated to a `StageExecutor`, so the
 * engine stays pure orchestration and free of business logic. The executor is
 * where agent runs, context building, rules, routing, and publishing plug in.
 */

import type {
  AsyncResult,
  Budget,
  BudgetGuard,
  PlatformError,
  StageId,
  StageState,
  WorkflowDefinition,
  WorkflowEngine,
  WorkflowStage,
  WorkflowState,
  WorkflowStatus,
} from '@ai-review/core';

/** Outcome of executing a single stage. */
export type StageOutcome =
  | { readonly kind: 'completed' }
  /** Transient failure: the engine may retry up to the stage's `maxRetries`. */
  | { readonly kind: 'retryable'; readonly reason: string }
  /** Permanent failure: the stage (and dependents) cannot proceed. */
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Executes the work behind a stage. Implementations live at the composition root
 * (wiring agent-runtime, context-engine, rules, etc.). Kept out of `core` because
 * it is engine machinery, not a cross-package contract.
 */
export interface StageExecutor {
  execute(stage: WorkflowStage, budget: BudgetGuard): AsyncResult<StageOutcome>;
}

function fail(code: string, message: string, details?: Record<string, unknown>): PlatformError {
  return details === undefined
    ? { category: 'validation', code, message }
    : { category: 'validation', code, message, details };
}

/**
 * Validates the DAG: every dependency must exist, ids must be unique, and there
 * must be no cycles. Returns an error describing the first problem found.
 */
function validate(def: WorkflowDefinition): PlatformError | undefined {
  const ids = new Set<StageId>();
  for (const stage of def.stages) {
    if (ids.has(stage.id)) {
      return fail('workflow.duplicate_stage', `duplicate stage id "${stage.id}"`);
    }
    ids.add(stage.id);
  }
  for (const stage of def.stages) {
    for (const dep of stage.dependsOn) {
      if (!ids.has(dep)) {
        return fail(
          'workflow.unknown_dependency',
          `stage "${stage.id}" depends on unknown stage "${dep}"`,
        );
      }
    }
  }

  // Cycle detection via DFS with coloring (white/grey/black).
  const color = new Map<StageId, 0 | 1 | 2>();
  const byId = new Map<StageId, WorkflowStage>(def.stages.map((s) => [s.id, s]));
  const visit = (id: StageId): StageId | undefined => {
    color.set(id, 1);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      const c = color.get(dep) ?? 0;
      if (c === 1) return dep; // back-edge ⇒ cycle
      if (c === 0) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    color.set(id, 2);
    return undefined;
  };
  for (const stage of def.stages) {
    if ((color.get(stage.id) ?? 0) === 0) {
      const cycleAt = visit(stage.id);
      if (cycleAt) {
        return fail('workflow.cycle_detected', `cycle detected involving stage "${cycleAt}"`);
      }
    }
  }
  return undefined;
}

interface MutableStageState {
  status: StageState['status'];
  attempts: number;
  startedAt?: number;
  finishedAt?: number;
}

export class DagWorkflowEngine implements WorkflowEngine {
  constructor(
    private readonly executor: StageExecutor,
    /** Factory so each run gets a fresh budget tally. */
    private readonly makeBudgetGuard: (budget: Budget) => BudgetGuard,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async run(definition: WorkflowDefinition, budget: Budget): AsyncResult<WorkflowState> {
    const invalid = validate(definition);
    if (invalid) return { ok: false, error: invalid };

    const guard = this.makeBudgetGuard(budget);
    const state = new Map<StageId, MutableStageState>(
      definition.stages.map((s) => [s.id, { status: 'pending', attempts: 0 }]),
    );

    const depsSatisfied = (stage: WorkflowStage): boolean =>
      stage.dependsOn.every((d) => state.get(d)?.status === 'completed');
    const depFailed = (stage: WorkflowStage): boolean =>
      stage.dependsOn.some((d) => {
        const s = state.get(d)?.status;
        return s === 'failed' || s === 'skipped';
      });

    let degraded = false;

    // Schedule in waves: each iteration runs all currently-ready stages in
    // parallel, then re-evaluates readiness. Terminates because every wave marks
    // at least one stage terminal (or there is nothing left to do).
    for (;;) {
      const pending = definition.stages.filter((s) => state.get(s.id)!.status === 'pending');
      if (pending.length === 0) break;

      // Stop early and degrade if the budget is already blown.
      if (guard.status().exceeded.length > 0) {
        for (const s of pending) state.get(s.id)!.status = 'skipped';
        degraded = true;
        break;
      }

      // Cascade dependency failures: a stage whose dep failed can never run.
      const blocked = pending.filter(depFailed);
      for (const s of blocked) state.get(s.id)!.status = 'skipped';

      const ready = pending.filter((s) => !depFailed(s) && depsSatisfied(s));
      if (ready.length === 0) {
        // Nothing ready and nothing running ⇒ remaining stages are unreachable.
        if (!definition.stages.some((s) => state.get(s.id)!.status === 'running')) break;
        continue;
      }

      // Run all ready stages concurrently (they are, by construction, independent).
      await Promise.all(ready.map((stage) => this.runStage(stage, guard, state)));
    }

    const stages: StageState[] = definition.stages.map((s) => {
      const m = state.get(s.id)!;
      const base = { stageId: s.id, status: m.status, attempts: m.attempts };
      return {
        ...base,
        ...(m.startedAt !== undefined ? { startedAt: m.startedAt } : {}),
        ...(m.finishedAt !== undefined ? { finishedAt: m.finishedAt } : {}),
      };
    });

    const anyFailed = stages.some((s) => s.status === 'failed');
    const anySkipped = stages.some((s) => s.status === 'skipped');
    let status: WorkflowStatus;
    if (anyFailed) status = 'failed';
    else if (degraded || anySkipped) status = 'degraded';
    else status = 'completed';

    return { ok: true, value: { workflowId: definition.id, status, stages } };
  }

  private async runStage(
    stage: WorkflowStage,
    guard: BudgetGuard,
    state: Map<StageId, MutableStageState>,
  ): Promise<void> {
    const m = state.get(stage.id)!;
    m.status = 'running';
    m.startedAt = this.now();
    const maxRetries = stage.maxRetries ?? 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      m.attempts = attempt + 1;

      let outcome: StageOutcome;
      try {
        const res = await this.executor.execute(stage, guard);
        if (!res.ok) {
          // A hard executor error is treated as permanent failure for the stage.
          m.status = 'failed';
          m.finishedAt = this.now();
          return;
        }
        outcome = res.value;
      } catch {
        outcome = { kind: 'retryable', reason: 'stage executor threw' };
      }

      if (outcome.kind === 'completed') {
        m.status = 'completed';
        m.finishedAt = this.now();
        return;
      }
      if (outcome.kind === 'failed') {
        m.status = 'failed';
        m.finishedAt = this.now();
        return;
      }
      // retryable ⇒ loop again if attempts remain; else fall through to failed.
    }

    m.status = 'failed';
    m.finishedAt = this.now();
  }
}
