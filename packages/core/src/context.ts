/**
 * Context Engine contracts — the most important module (ADR-0004).
 *
 * Guarantees: build context once, share by handle, serve minimal slices, never
 * duplicate tokens. Events and agents pass `ContextHandle`s, not payloads.
 */

import type { ContentHash, ContextHandle } from './ids.js';
import type { AsyncResult } from './result.js';
import type { CodeLocation } from './issue.js';

/** A symbol (function/component/hook/class/type) extracted from the AST. */
export interface SymbolInfo {
  readonly name: string;
  readonly kind: 'function' | 'component' | 'hook' | 'class' | 'type' | 'variable' | 'other';
  readonly location: CodeLocation;
  /** Signature only; bodies are sent lazily and only when changed/requested. */
  readonly signature: string;
  readonly changed: boolean;
}

/** A file's extracted structure. */
export interface FileContext {
  readonly path: string;
  readonly hash: ContentHash;
  readonly imports: readonly string[];
  readonly exports: readonly string[];
  readonly symbols: readonly SymbolInfo[];
  readonly changed: boolean;
}

/** Project-level configuration relevant to review. */
export interface ProjectContext {
  readonly packageInfo?: Readonly<Record<string, unknown>>;
  readonly tsConfig?: Readonly<Record<string, unknown>>;
  readonly lintConfig?: Readonly<Record<string, unknown>>;
  /** Documentation, contributing guidelines, and custom rules discovered in docs/ or root */
  readonly guidelines?: readonly { readonly path: string; readonly content: string }[];
  /** Lint rules and conventions extracted from project config files */
  readonly lintRules?: readonly { readonly name: string; readonly description: string }[];
  /** Custom rules or instructions discovered in the repository */
  readonly customRules?: readonly string[];
}

/**
 * The normalized, addressable, deduplicated knowledge graph built once per
 * review and stored in the Context Store. Agents never receive this whole; they
 * request slices.
 */
export interface SharedContext {
  readonly handle: ContextHandle;
  /** Version bumps on every rebuild; part of the context cache key. */
  readonly version: number;
  readonly files: readonly FileContext[];
  /** import/export dependency graph as adjacency (path -> dependency paths). */
  readonly dependencyGraph: Readonly<Record<string, readonly string[]>>;
  readonly changedSymbols: readonly SymbolInfo[];
  readonly project: ProjectContext;
}

/** What an agent declares it needs. The engine returns the *smallest* slice. */
export interface ContextRequest {
  readonly handle: ContextHandle;
  /** Restrict to these files/paths if provided. */
  readonly paths?: readonly string[];
  /** Include related symbols/parents/hooks of changed symbols. */
  readonly includeRelated?: boolean;
  /** Include full symbol bodies (default: signatures only). */
  readonly includeBodies?: boolean;
  /** Token budget for this slice; the engine trims lowest-value context to fit. */
  readonly tokenBudget?: number;
}

/** The minimal, possibly compressed context returned to an agent. */
export interface ContextSlice {
  readonly handle: ContextHandle;
  readonly version: number;
  readonly files: readonly FileContext[];
  /** Rendered, token-bounded text ready to embed in a prompt. */
  readonly rendered: string;
  readonly estimatedTokens: number;
  /** True when semantic/structural compression was applied to fit the budget. */
  readonly compressed: boolean;
}

/**
 * Builds and serves shared context. Implementation lives in `context-engine`.
 * The Context Store persistence is a separate backend behind the same handles.
 */
export interface ContextEngine {
  /** Build the shared context once for a review from its input. Idempotent by content hash. */
  build(input: ContextBuildInput): AsyncResult<SharedContext>;
  /** Retrieve a previously built shared context by handle. */
  get(handle: ContextHandle): AsyncResult<SharedContext | undefined>;
  /** Serve the minimal slice satisfying a request (drawn from the built graph). */
  slice(request: ContextRequest): AsyncResult<ContextSlice>;
}

/** Opaque-to-core description of what to build context from (folder/diff/etc.). */
export interface ContextBuildInput {
  readonly repositoryId: string;
  readonly commitHash?: string;
  /** Raw diff/patch text when reviewing a change set. */
  readonly diff?: string;
}
