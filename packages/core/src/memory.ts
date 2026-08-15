/**
 * Memory contracts.
 *
 * Multiple scopes with increasing lifetime and breadth. Agents receive a memory
 * handle bound to their declared `memoryScope`; they cannot read/write outside it.
 */

import type { AsyncResult } from './result.js';

/** Memory scopes, from most ephemeral to most durable/broad. */
export type MemoryScope = 'session' | 'review' | 'repository' | 'organization' | 'global';

export interface MemoryRecord<V = unknown> {
  readonly key: string;
  readonly value: V;
  readonly scope: MemoryScope;
  readonly updatedAt: number;
}

/** A key/value store partitioned by scope. Backends live outside `core`. */
export interface MemoryStore {
  get<V = unknown>(scope: MemoryScope, key: string): AsyncResult<MemoryRecord<V> | undefined>;
  set<V = unknown>(scope: MemoryScope, key: string, value: V): AsyncResult<void>;
  delete(scope: MemoryScope, key: string): AsyncResult<void>;
  list(scope: MemoryScope, prefix?: string): AsyncResult<readonly string[]>;
}

/**
 * Scope-bound handle given to an agent. All operations are implicitly confined
 * to the bound scope, enforcing memory isolation.
 */
export interface MemoryHandle {
  readonly scope: MemoryScope;
  get<V = unknown>(key: string): AsyncResult<MemoryRecord<V> | undefined>;
  set<V = unknown>(key: string, value: V): AsyncResult<void>;
  delete(key: string): AsyncResult<void>;
}
