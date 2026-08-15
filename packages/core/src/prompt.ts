/**
 * Prompt management contracts.
 *
 * Prompts are versioned assets (ADR-0007/0008): versioning enables prompt
 * caching, response-cache invalidation, and regression testing. Rendering is
 * deterministic given a prompt id, version, and variables.
 */

import type { PromptId } from './ids.js';
import type { AsyncResult } from './result.js';

/** A versioned prompt template. Bumping `version` invalidates prompt caches. */
export interface PromptTemplate {
  readonly id: PromptId;
  readonly version: number;
  readonly description: string;
  /** Template body with named `{{variables}}`. */
  readonly template: string;
  /** Variable names the template expects, for validation. */
  readonly variables: readonly string[];
}

/** A rendered prompt ready to send, plus the identity used for cache keys. */
export interface RenderedPrompt {
  readonly id: PromptId;
  readonly version: number;
  readonly text: string;
}

export interface PromptRegistry {
  register(template: PromptTemplate): void;
  get(id: PromptId, version?: number): PromptTemplate | undefined;
  list(): readonly PromptTemplate[];
}

/** Deterministically renders a template with variables. Lives in `prompts`. */
export interface PromptRenderer {
  render(
    id: PromptId,
    variables: Readonly<Record<string, string>>,
    version?: number,
  ): AsyncResult<RenderedPrompt>;
}
