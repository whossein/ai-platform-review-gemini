/**
 * Incremental review snapshots (ADR-0010, the token lever for re-reviews).
 *
 * Every completed review yields a `ReviewSnapshot`: its findings plus a
 * per-symbol fingerprint (a content hash of each changed symbol). The next
 * review fingerprints the new code and calls `diff(base, next)` to learn which
 * symbols actually changed — so specialists only re-review *those*, and stable
 * code reuses the prior snapshot's findings for free.
 *
 * `changedSymbols` / `unchangedSymbols` express that decision directly, and
 * `carryForward` lets the orchestrator reuse prior findings for unchanged files
 * without spending a single token on them.
 *
 * This in-memory implementation satisfies the `SnapshotStore` contract; a
 * production backend (DB/object store) drops in behind the same interface.
 */

import type {
  AdjudicatedIssue,
  AsyncResult,
  ReviewSnapshot,
  SnapshotId,
  SymbolFingerprint,
} from '@ai-review/core';
import type { SnapshotStore } from '@ai-review/core';

/** Key a fingerprint by its identity (file + symbol), independent of its hash. */
function symbolKey(fp: SymbolFingerprint): string {
  return `${fp.file}#${fp.symbol}`;
}

export interface SnapshotDiff {
  /** Symbols whose hash changed or that are new — must be re-reviewed. */
  readonly changed: readonly SymbolFingerprint[];
  /** Symbols identical to the base snapshot — findings can be carried forward. */
  readonly unchanged: readonly SymbolFingerprint[];
  /** Symbols present in the base but gone now — their findings are dropped. */
  readonly removed: readonly SymbolFingerprint[];
}

export class InMemorySnapshotStore implements SnapshotStore {
  /** reviewScope → snapshots in insertion order (latest last). */
  private readonly byScope = new Map<string, ReviewSnapshot[]>();
  /** snapshotId → snapshot, for base lookups in `diff`. */
  private readonly byId = new Map<SnapshotId, ReviewSnapshot>();

  async save(snapshot: ReviewSnapshot): AsyncResult<void> {
    const scope = snapshot.reviewId as unknown as string;
    const list = this.byScope.get(scope) ?? [];
    list.push(snapshot);
    this.byScope.set(scope, list);
    this.byId.set(snapshot.id, snapshot);
    return { ok: true, value: undefined };
  }

  async getLatest(reviewScope: string): AsyncResult<ReviewSnapshot | undefined> {
    const list = this.byScope.get(reviewScope);
    return { ok: true, value: list && list.length > 0 ? list[list.length - 1] : undefined };
  }

  /** Contract method: return only the fingerprints that changed vs. a base. */
  async diff(
    base: SnapshotId,
    next: readonly SymbolFingerprint[],
  ): AsyncResult<readonly SymbolFingerprint[]> {
    const full = this.diffDetailed(base, next);
    return { ok: true, value: full.changed };
  }

  /**
   * Richer diff used by the orchestrator: classifies every symbol as changed,
   * unchanged, or removed. When the base is unknown, everything counts as
   * changed (first review — nothing to reuse).
   */
  diffDetailed(base: SnapshotId | undefined, next: readonly SymbolFingerprint[]): SnapshotDiff {
    const baseSnap = base ? this.byId.get(base) : undefined;
    if (!baseSnap) {
      return { changed: [...next], unchanged: [], removed: [] };
    }

    const baseByKey = new Map<string, SymbolFingerprint>();
    for (const fp of baseSnap.fingerprints) baseByKey.set(symbolKey(fp), fp);

    const changed: SymbolFingerprint[] = [];
    const unchanged: SymbolFingerprint[] = [];
    const seen = new Set<string>();

    for (const fp of next) {
      const key = symbolKey(fp);
      seen.add(key);
      const prior = baseByKey.get(key);
      if (!prior || prior.hash !== fp.hash) changed.push(fp);
      else unchanged.push(fp);
    }

    const removed: SymbolFingerprint[] = [];
    for (const [key, fp] of baseByKey) {
      if (!seen.has(key)) removed.push(fp);
    }

    return { changed, unchanged, removed };
  }

  /**
   * Reuse prior findings for symbols that did not change, so re-reviews spend
   * zero tokens on stable code. Returns the carried-forward issues from `base`
   * whose (file) is among the unchanged set.
   */
  carryForward(
    base: SnapshotId | undefined,
    unchanged: readonly SymbolFingerprint[],
  ): readonly AdjudicatedIssue[] {
    const baseSnap = base ? this.byId.get(base) : undefined;
    if (!baseSnap) return [];
    const unchangedFiles = new Set(unchanged.map((fp) => fp.file));
    return baseSnap.issues.filter((issue) => unchangedFiles.has(issue.location.file));
  }
}
