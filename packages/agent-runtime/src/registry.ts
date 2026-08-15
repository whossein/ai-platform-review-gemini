/**
 * In-memory agent registry (ADR-0003).
 *
 * Agents are registered dynamically at boot by first-party code and plugins.
 * Nothing in the platform hardcodes an agent; everything is looked up by id.
 */

import type { AgentDefinition, AgentId, AgentRegistry, RegisteredAgent } from '@ai-review/core';

/**
 * A simple Map-backed registry. Registration is idempotent-by-id: re-registering
 * the same id replaces the previous entry (last write wins) so plugins can
 * override defaults deliberately.
 */
export class MapAgentRegistry implements AgentRegistry {
  private readonly agents = new Map<AgentId, RegisteredAgent>();

  register(agent: RegisteredAgent): void {
    this.agents.set(agent.definition.id, agent);
  }

  get(id: AgentId): RegisteredAgent | undefined {
    return this.agents.get(id);
  }

  list(): readonly AgentDefinition[] {
    return (
      [...this.agents.values()]
        .map((a) => a.definition)
        // Higher priority first; stable by id for deterministic ordering.
        .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1))
    );
  }
}
