/**
 * Workflow engine contracts (ADR-0005).
 *
 * Workflows are declarative DAGs of stages with dependencies, parallelism, and
 * budget hooks. The engine schedules stages, enforces budgets, handles
 * retries/escalation, and emits an event at every transition.
 */

import type { AgentId, StageId, WorkflowId } from './ids.js';
import type { AsyncResult } from './result.js';
import type { Budget } from './budget.js';

/** Well-known stage kinds; plugins may add more. */
export type StageKind =
  | 'planner'
  | 'context_builder'
  | 'rule_engine'
  | 'routing'
  | 'agent'
  | 'critic'
  | 'judge'
  | 'reporter'
  | 'publisher'
  | (string & {});

/** A single node in the workflow DAG. */
export interface WorkflowStage {
  readonly id: StageId;
  readonly kind: StageKind;
  /** Stage ids that must complete before this one. Empty ⇒ can start immediately. */
  readonly dependsOn: readonly StageId[];
  /** For `agent` stages: which agent runs. */
  readonly agentId?: AgentId;
  /** Stages sharing a `parallelGroup` with satisfied deps run concurrently. */
  readonly parallelGroup?: string;
  /** Optional per-stage budget cap (subset of the review budget). */
  readonly budget?: Partial<Budget>;
  /** Max retries for transient failures before the stage is failed. */
  readonly maxRetries?: number;
}

/** A declarative workflow definition — data, not code. */
export interface WorkflowDefinition {
  readonly id: WorkflowId;
  readonly name: string;
  readonly description: string;
  readonly stages: readonly WorkflowStage[];
}

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StageState {
  readonly stageId: StageId;
  readonly status: StageStatus;
  readonly attempts: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
}

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'degraded';

/** Live state of a running workflow. */
export interface WorkflowState {
  readonly workflowId: WorkflowId;
  readonly status: WorkflowStatus;
  readonly stages: readonly StageState[];
}

export interface WorkflowRegistry {
  register(definition: WorkflowDefinition): void;
  get(id: WorkflowId): WorkflowDefinition | undefined;
  list(): readonly WorkflowDefinition[];
}

/**
 * Schedules and runs a workflow DAG. On `budget.exceeded`, degrades gracefully
 * (proceeds to reporting with partial results) rather than hard-failing.
 * Implementation lives in `workflow-engine`.
 */
export interface WorkflowEngine {
  run(definition: WorkflowDefinition, budget: Budget): AsyncResult<WorkflowState>;
}
