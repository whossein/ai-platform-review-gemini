/**
 * @ai-review/memory
 *
 * Multi-scope memory (ARCHITECTURE §11):
 *  - `InMemoryMemoryStore` — session/review/repository/organization/global,
 *    with `bindScope` producing an isolated, scope-bound `MemoryHandle`.
 *
 * A production backend (Redis/DB) implements the same `MemoryStore` contract.
 */

export { InMemoryMemoryStore } from './store.js';
export { InMemorySnapshotStore, type SnapshotDiff } from './snapshots.js';
