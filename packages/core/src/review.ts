/**
 * Review orchestration & snapshot contracts.
 *
 * A `ReviewRequest` is the top-level unit of work. Every review produces a
 * `ReviewSnapshot`; future reviews diff against the last snapshot and re-review
 * only changed symbols (ADR-0010).
 */

import type { ContentHash, IsoTimestamp, ReviewId, SnapshotId, WorkflowId } from './ids.js';
import type { AsyncResult } from './result.js';
import type { Budget } from './budget.js';
import type { ReviewInput } from './repository.js';
import type { AdjudicatedIssue } from './issue.js';

/** The top-level request that starts a review. */
export interface ReviewRequest {
  readonly reviewId: ReviewId;
  readonly input: ReviewInput;
  readonly workflowId: WorkflowId;
  readonly budget: Budget;
  /** Optional prior snapshot to enable incremental review. */
  readonly baseSnapshotId?: SnapshotId;
}

/** A per-symbol fingerprint used for incremental reconciliation. */
export interface SymbolFingerprint {
  readonly symbol: string;
  readonly file: string;
  readonly hash: ContentHash;
}

/**
 * An immutable record of a completed review: findings + fingerprints + context
 * version. Content-addressed and stored in the repository memory scope.
 */
export interface ReviewSnapshot {
  readonly id: SnapshotId;
  readonly reviewId: ReviewId;
  readonly createdAt: IsoTimestamp;
  readonly contextVersion: number;
  readonly issues: readonly AdjudicatedIssue[];
  readonly fingerprints: readonly SymbolFingerprint[];
}

/** The outcome returned to the caller when a review finishes. */
export interface ReviewOutcome {
  readonly reviewId: ReviewId;
  readonly snapshot: ReviewSnapshot;
  readonly degraded: boolean;
}

/** Persists and reconciles snapshots for incremental review. */
export interface SnapshotStore {
  save(snapshot: ReviewSnapshot): AsyncResult<void>;
  getLatest(reviewScope: string): AsyncResult<ReviewSnapshot | undefined>;
  /** Return the fingerprints that changed vs. a base snapshot. */
  diff(
    base: SnapshotId,
    next: readonly SymbolFingerprint[],
  ): AsyncResult<readonly SymbolFingerprint[]>;
}

/** Top-level orchestration entry point. Implementation wires the pipeline. */
export interface ReviewOrchestrator {
  review(request: ReviewRequest): AsyncResult<ReviewOutcome>;
}
