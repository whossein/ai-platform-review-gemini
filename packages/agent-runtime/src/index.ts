/**
 * @ai-review/agent-runtime
 *
 * Reference implementation of the dynamic agent runtime (ADR-0003):
 *  - `MapAgentRegistry`   — dynamic, id-addressed agent registration.
 *  - `DefaultAgentRuntime` — executes agents under budget + capability gating,
 *                            validating structured output before returning.
 */

export { MapAgentRegistry } from './registry.js';
export { DefaultAgentRuntime } from './runtime.js';
