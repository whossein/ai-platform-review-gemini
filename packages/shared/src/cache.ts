/**
 * In-memory content-addressed cache (ADR-0004).
 *
 * A single generic implementation backs every tier (repository, ast, context,
 * prompt, llm_response, embedding, review). It is content-addressed, supports
 * TTL, tracks hit/miss stats (telemetry), and offers explicit + prefix
 * invalidation as the contract requires. A production backend (Redis/DB)
 * implements the same `Cache<V>` interface and drops in without caller changes.
 */

import type { Cache, CacheEntry, CacheKey, CacheStats, CacheTier } from '@ai-review/core';
import { sha256, stableStringify } from './hash.js';
import { ok } from './result.js';

export class InMemoryCache<V> implements Cache<V> {
  readonly tier: CacheTier;
  private readonly store = new Map<string, CacheEntry<V>>();
  private hits = 0;
  private misses = 0;
  private readonly now: () => number;

  constructor(tier: CacheTier, now: () => number = Date.now) {
    this.tier = tier;
    this.now = now;
  }

  private isExpired(entry: CacheEntry<V>): boolean {
    return entry.ttlMs !== undefined && this.now() - entry.storedAt > entry.ttlMs;
  }

  async get(key: CacheKey) {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      if (entry) this.store.delete(key); // evict expired
      this.misses++;
      return ok(undefined);
    }
    this.hits++;
    return ok(entry);
  }

  async set(key: CacheKey, value: V, opts?: { readonly ttlMs?: number }) {
    const entry: CacheEntry<V> = {
      key,
      value,
      hash: sha256(stableStringify(value)),
      storedAt: this.now(),
      ...(opts?.ttlMs !== undefined ? { ttlMs: opts.ttlMs } : {}),
    };
    this.store.set(key, entry);
    return ok(undefined);
  }

  async has(key: CacheKey) {
    const entry = this.store.get(key);
    return ok(entry !== undefined && !this.isExpired(entry));
  }

  async invalidate(key: CacheKey) {
    this.store.delete(key);
    return ok(undefined);
  }

  async invalidatePrefix(prefix: string) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
    return ok(undefined);
  }

  stats(): CacheStats {
    return { hits: this.hits, misses: this.misses };
  }
}

/**
 * Convenience: a set of caches, one per tier, sharing a clock. This is what an
 * orchestrator wires up once and threads through the review.
 */
export class CacheSet {
  private readonly caches = new Map<CacheTier, InMemoryCache<unknown>>();

  constructor(private readonly now: () => number = Date.now) {}

  tier<V>(tier: CacheTier): Cache<V> {
    let cache = this.caches.get(tier);
    if (!cache) {
      cache = new InMemoryCache<unknown>(tier, this.now);
      this.caches.set(tier, cache);
    }
    return cache as unknown as Cache<V>;
  }

  /** Aggregate hit/miss across all tiers (for review-level telemetry). */
  totals(): CacheStats {
    let hits = 0;
    let misses = 0;
    for (const cache of this.caches.values()) {
      const s = cache.stats();
      hits += s.hits;
      misses += s.misses;
    }
    return { hits, misses };
  }
}
