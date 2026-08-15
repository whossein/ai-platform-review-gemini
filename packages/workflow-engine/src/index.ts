/**
 * @ai-review/workflow-engine
 *
 * Reference implementation of the DAG workflow engine (ADR-0005):
 *  - `MapWorkflowRegistry` — dynamic, id-addressed workflow registration.
 *  - `DagWorkflowEngine`    — validates + schedules a DAG with parallelism,
 *                             retries, and budget-aware graceful degradation.
 *  - `StageExecutor`        — the plug point where stage work (agents, context,
 *                             rules, routing, publishing) is wired in.
 */

export { MapWorkflowRegistry } from './registry.js';
export { DagWorkflowEngine } from './engine.js';
export type { StageExecutor, StageOutcome } from './engine.js';
