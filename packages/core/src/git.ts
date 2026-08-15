/**
 * Git & provider contracts.
 *
 * The provider abstraction supports GitLab, GitHub, Azure DevOps, and Bitbucket.
 * The first implementation targets GitLab self-hosted. No caller depends on a
 * specific provider.
 */

import type { AsyncResult } from './result.js';

export type GitProviderKind = 'gitlab' | 'github' | 'azure_devops' | 'bitbucket';

/** Identifies a merge/pull request across providers. */
export interface ChangeRequestRef {
  readonly provider: GitProviderKind;
  readonly projectId: string;
  /** MR/PR number or id. */
  readonly id: string;
}

export interface ChangeRequest {
  readonly ref: ChangeRequestRef;
  readonly title: string;
  readonly description: string;
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly author: string;
  readonly state: 'open' | 'merged' | 'closed';
}

/** A discussion/comment thread on a change request. */
export interface Discussion {
  readonly id: string;
  readonly resolved: boolean;
  readonly location?: { readonly file: string; readonly line?: number };
  readonly body: string;
}

export type PipelineStatus = 'success' | 'failed' | 'running' | 'pending' | 'canceled' | 'unknown';

/**
 * Provider-agnostic capabilities required by the platform:
 * Read MR · Read Diff · Read Discussions · Create/Reply/Resolve Discussion ·
 * Approve MR · Pipeline Status.
 */
export interface GitProvider {
  readonly kind: GitProviderKind;

  getChangeRequest(ref: ChangeRequestRef): AsyncResult<ChangeRequest>;
  getDiff(ref: ChangeRequestRef): AsyncResult<string>;
  listDiscussions(ref: ChangeRequestRef): AsyncResult<readonly Discussion[]>;

  createDiscussion(
    ref: ChangeRequestRef,
    body: string,
    location?: { readonly file: string; readonly line?: number },
  ): AsyncResult<Discussion>;
  replyDiscussion(
    ref: ChangeRequestRef,
    discussionId: string,
    body: string,
  ): AsyncResult<Discussion>;
  resolveDiscussion(ref: ChangeRequestRef, discussionId: string): AsyncResult<void>;

  approve(ref: ChangeRequestRef): AsyncResult<void>;
  getPipelineStatus(ref: ChangeRequestRef): AsyncResult<PipelineStatus>;
}

export interface GitProviderRegistry {
  register(provider: GitProvider): void;
  get(kind: GitProviderKind): GitProvider | undefined;
}
