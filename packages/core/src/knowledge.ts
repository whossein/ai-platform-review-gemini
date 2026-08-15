/**
 * Knowledge system contracts.
 *
 * Drives continuous improvement: knowledge base, review history, false-positive
 * database, accepted/rejected suggestions, reviewer feedback, project/org rules,
 * pattern learning. The Judge consults these to reduce false positives and cost
 * over time (ARCHITECTURE §11).
 */

import type { AsyncResult } from './result.js';
import type { ContentHash, OrganizationId, RepositoryId } from './ids.js';
import type { Issue } from './issue.js';

/** Whether a reviewer accepted or rejected a suggested finding. */
export type FeedbackVerdict = 'accepted' | 'rejected';

export interface ReviewerFeedback {
  readonly issueFingerprint: ContentHash;
  readonly verdict: FeedbackVerdict;
  readonly reviewer?: string;
  readonly note?: string;
  readonly at: number;
}

/** A learned false positive; the Judge suppresses matching future findings. */
export interface FalsePositiveEntry {
  readonly fingerprint: ContentHash;
  readonly category: Issue['category'];
  readonly reason: string;
}

/** A configurable rule at project or organization scope. */
export interface KnowledgeRule {
  readonly id: string;
  readonly scope: 'project' | 'organization';
  readonly description: string;
  /** Machine-readable predicate/config; interpreted by the Judge/Rule engine. */
  readonly config: Readonly<Record<string, unknown>>;
}

/** A learned recurring pattern (good or bad) used to guide future reviews. */
export interface LearnedPattern {
  readonly id: string;
  readonly description: string;
  readonly confidence: number;
}

/**
 * Persistent knowledge store. Backends live outside `core`. Reads are cheap and
 * consulted by the Judge; writes come from reviewer feedback + review outcomes.
 */
export interface KnowledgeStore {
  recordFeedback(feedback: ReviewerFeedback): AsyncResult<void>;
  isKnownFalsePositive(fingerprint: ContentHash): AsyncResult<boolean>;
  listFalsePositives(repo: RepositoryId): AsyncResult<readonly FalsePositiveEntry[]>;
  listRules(scope: {
    readonly repository?: RepositoryId;
    readonly organization?: OrganizationId;
  }): AsyncResult<readonly KnowledgeRule[]>;
  listPatterns(repo: RepositoryId): AsyncResult<readonly LearnedPattern[]>;
}
