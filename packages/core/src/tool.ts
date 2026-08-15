/**
 * MCP-first tool contracts (ADR-0009).
 *
 * First-party tools (fs, git, gitlab, terminal, docker, node, llm) implement
 * the same contract as external MCP servers, so future integrations plug in
 * without architectural change. Agents declare `allowedTools`; the runtime
 * capability-gates access regardless of origin.
 */

import type { ToolId } from './ids.js';
import type { AsyncResult } from './result.js';

/** Where a tool implementation comes from. */
export type ToolOrigin = 'internal' | 'mcp';

/** A JSON-schema-described tool input/output, MCP-aligned. */
export interface ToolSchema {
  readonly input: Readonly<Record<string, unknown>>;
  readonly output: Readonly<Record<string, unknown>>;
}

/** Capabilities a tool may require (drives sandboxing + gating). */
export type ToolCapability =
  | 'filesystem_read'
  | 'filesystem_write'
  | 'network'
  | 'process_exec'
  | 'git_read'
  | 'git_write'
  | 'llm';

export interface ToolDescriptor {
  readonly id: ToolId;
  readonly name: string;
  readonly description: string;
  readonly origin: ToolOrigin;
  readonly schema: ToolSchema;
  readonly capabilities: readonly ToolCapability[];
}

export interface ToolInvocation {
  readonly toolId: ToolId;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ToolResult {
  readonly output: Readonly<Record<string, unknown>>;
  /** Structured, non-secret diagnostics. */
  readonly diagnostics?: Readonly<Record<string, unknown>>;
}

/** A single tool. Internal and MCP tools share this contract. */
export interface Tool {
  readonly descriptor: ToolDescriptor;
  invoke(invocation: ToolInvocation): AsyncResult<ToolResult>;
}

/** Registry of available tools; plugins/MCP servers register here at boot. */
export interface ToolRegistry {
  register(tool: Tool): void;
  get(id: ToolId): Tool | undefined;
  list(): readonly ToolDescriptor[];
}

/**
 * Capability-gated, sandboxed access handed to an agent. The runtime scopes
 * this to the agent's `allowedTools`; calls to disallowed tools are refused.
 */
export interface ToolAccessor {
  invoke(invocation: ToolInvocation): AsyncResult<ToolResult>;
  available(): readonly ToolDescriptor[];
}
