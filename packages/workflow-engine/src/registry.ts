/**
 * In-memory workflow registry (ADR-0005).
 *
 * Workflows are declarative DAGs registered dynamically at boot by first-party
 * code and plugins. Nothing hardcodes a flow; everything is looked up by id.
 */

import type { WorkflowDefinition, WorkflowId, WorkflowRegistry } from '@ai-review/core';

/** Map-backed registry. Registration is idempotent-by-id (last write wins). */
export class MapWorkflowRegistry implements WorkflowRegistry {
  private readonly workflows = new Map<WorkflowId, WorkflowDefinition>();

  register(definition: WorkflowDefinition): void {
    this.workflows.set(definition.id, definition);
  }

  get(id: WorkflowId): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  list(): readonly WorkflowDefinition[] {
    return [...this.workflows.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }
}
