/**
 * Multi-scope memory store (ARCHITECTURE §11).
 *
 * A single in-memory `MemoryStore` partitioned by scope
 * (session/review/repository/organization/global). Agents never touch the store
 * directly — they receive a `MemoryHandle` bound to their declared scope via
 * `bindScope`, which enforces isolation: a review-scoped agent can never read or
 * write organization/global memory. A production backend (Redis/DB) implements
 * the same `MemoryStore` contract and drops in without caller changes.
 */

import type {
  AsyncResult,
  MemoryHandle,
  MemoryRecord,
  MemoryScope,
  MemoryStore,
} from '@ai-review/core';

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export class InMemoryMemoryStore implements MemoryStore {
  // scope → (key → record)
  private readonly scopes = new Map<MemoryScope, Map<string, MemoryRecord>>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private bucket(scope: MemoryScope): Map<string, MemoryRecord> {
    let bucket = this.scopes.get(scope);
    if (!bucket) {
      bucket = new Map();
      this.scopes.set(scope, bucket);
    }
    return bucket;
  }

  async get<V = unknown>(
    scope: MemoryScope,
    key: string,
  ): AsyncResult<MemoryRecord<V> | undefined> {
    return ok(this.bucket(scope).get(key) as MemoryRecord<V> | undefined);
  }

  async set<V = unknown>(scope: MemoryScope, key: string, value: V): AsyncResult<void> {
    this.bucket(scope).set(key, { key, value, scope, updatedAt: this.now() });
    return ok(undefined);
  }

  async delete(scope: MemoryScope, key: string): AsyncResult<void> {
    this.bucket(scope).delete(key);
    return ok(undefined);
  }

  async list(scope: MemoryScope, prefix?: string): AsyncResult<readonly string[]> {
    const keys = [...this.bucket(scope).keys()].filter((k) => !prefix || k.startsWith(prefix));
    keys.sort();
    return ok(keys);
  }

  /**
   * Returns a handle whose every operation is confined to `scope`. This is what
   * the agent runtime hands to an agent, enforcing memory-scope isolation.
   */
  bindScope(scope: MemoryScope): MemoryHandle {
    return {
      scope,
      get: <V = unknown>(key: string) => this.get<V>(scope, key),
      set: <V = unknown>(key: string, value: V) => this.set<V>(scope, key, value),
      delete: (key: string) => this.delete(scope, key),
    };
  }
}
