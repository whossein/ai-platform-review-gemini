/**
 * Structured finding contracts.
 *
 * Every agent returns JSON — never plain text — and every issue conforms to
 * this shape (ADR-0008). This is what powers publishing, metrics, snapshots,
 * and incremental review.
 */

import type { AgentId, ContentHash, IssueId } from './ids.js';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/**
 * The review domain an issue belongs to. Open-ended by design: plugins may
 * introduce new categories. Well-known values are enumerated for tooling.
 */
export type IssueCategory =
  | 'code'
  | 'security'
  | 'performance'
  | 'architecture'
  | 'accessibility'
  | 'testing'
  | 'dependency'
  | 'documentation'
  | (string & {});

/** A reference supporting a finding (docs, standards, related code). */
export interface IssueReference {
  readonly title: string;
  readonly url?: string;
  /** Optional in-repo location the reference points to. */
  readonly location?: CodeLocation;
}

/** A precise location within the repository. */
export interface CodeLocation {
  readonly file: string;
  readonly line?: number;
  readonly endLine?: number;
  readonly column?: number;
  readonly symbol?: string;
}

/** A proposed change addressing an issue. */
export interface Suggestion {
  readonly description: string;
  /** Optional unified-diff patch or replacement snippet. */
  readonly patch?: string;
  /** Whether the suggestion is safe to auto-apply. */
  readonly autoApplicable?: boolean;
}

/**
 * The canonical issue shape. Required fields mirror the platform spec:
 * id · title · description · severity · confidence · reason · suggestion ·
 * file · line · references · category.
 */
export interface Issue {
  readonly id: IssueId;
  readonly title: string;
  readonly description: string;
  readonly severity: Severity;
  /** Model/agent confidence in [0, 1]. Drives escalation and the trust pipeline. */
  readonly confidence: number;
  /** Why this is an issue — the reasoning, kept for the Critic/Judge. */
  readonly reason: string;
  readonly suggestion?: Suggestion;
  readonly location: CodeLocation;
  readonly references: readonly IssueReference[];
  readonly category: IssueCategory;

  /** Which agent produced it (provenance for the trust pipeline & telemetry). */
  readonly producedBy: AgentId;
  /**
   * Stable content fingerprint used for snapshot diffing / incremental review
   * (ADR-0010). Robust to formatting-only changes (AST-based, not raw text).
   */
  readonly fingerprint: ContentHash;
  /** Lifecycle status when reconciled against a prior snapshot. */
  readonly lifecycle?: IssueLifecycle;
}

export type IssueLifecycle = 'new' | 'persistent' | 'fixed' | 'carried_forward';

/** Verdict attached by the Judge after adjudication. */
export interface AdjudicatedIssue extends Issue {
  readonly accepted: boolean;
  readonly adjudicationReason: string;
  /** Rank score, typically severity × confidence, used for ordering. */
  readonly rankScore: number;
}
