/**
 * Caching contracts (ADR-0004, ADR-0007).
 *
 * A single generic, content-addressed `Cache` contract underlies every cache
 * tier (repository, AST, context, prompt, LLM response, embedding, review).
 * Every cache supports explicit invalidation. Backends (memory/Redis/DB) are
 * pluggable and live outside `core`.
 */

import type { CacheKey, ContentHash } from './ids.js';
import type { AsyncResult } from './result.js';

/** The named cache tiers the platform maintains. */
export type CacheTier =
  | 'repository'
  | 'ast'
  | 'context'
  | 'prompt'
  | 'llm_response'
  | 'embedding'
  | 'review';

export interface CacheEntry<V> {
  readonly key: CacheKey;
  readonly value: V;
  /** Content hash of the value, for integrity + addressing. */
  readonly hash: ContentHash;
  readonly storedAt: number;
  /** Optional time-to-live in ms; omitted means no TTL. */
  readonly ttlMs?: number;
}

export interface CacheStats {
  readonly hits: number;
  readonly misses: number;
}

/** Generic content-addressed cache. One instance per tier. */
export interface Cache<V> {
  readonly tier: CacheTier;
  get(key: CacheKey): AsyncResult<CacheEntry<V> | undefined>;
  set(key: CacheKey, value: V, opts?: { readonly ttlMs?: number }): AsyncResult<void>;
  has(key: CacheKey): AsyncResult<boolean>;
  /** Explicit invalidation — required of every tier. */
  invalidate(key: CacheKey): AsyncResult<void>;
  /** Invalidate everything matching a key prefix (e.g., all entries for a commit). */
  invalidatePrefix(prefix: string): AsyncResult<void>;
  stats(): CacheStats;
}

/**
 * Builds deterministic, content-addressed cache keys. Implementation in
 * `shared`; keeping it a contract lets tests inject a stub.
 */
export interface CacheKeyBuilder {
  build(tier: CacheTier, parts: readonly (string | number)[]): CacheKey;
}
