/**
 * Repository & input-method contracts.
 *
 * Supported inputs: Local Folder · Git Repository · Git Diff · Patch File ·
 * Commit · Branch · Merge Request URL · Pull Request URL · Clipboard Diff.
 * Each input is normalized into a `ReviewInput` the rest of the platform
 * consumes uniformly.
 */

import type { RepositoryId } from './ids.js';
import type { AsyncResult } from './result.js';
import type { ChangeRequestRef } from './git.js';

/** The supported ways a review can be initiated. */
export type ReviewInputKind =
  | 'local_folder'
  | 'git_repository'
  | 'git_diff'
  | 'patch_file'
  | 'commit'
  | 'branch'
  | 'merge_request_url'
  | 'pull_request_url'
  | 'clipboard_diff';

/** Discriminated union describing a raw review input before normalization. */
export type ReviewInputSource =
  | { readonly kind: 'local_folder'; readonly path: string }
  | { readonly kind: 'git_repository'; readonly url: string; readonly ref?: string }
  | { readonly kind: 'git_diff'; readonly diff: string }
  | { readonly kind: 'patch_file'; readonly path: string }
  | { readonly kind: 'commit'; readonly repo: string; readonly commitHash: string }
  | { readonly kind: 'branch'; readonly repo: string; readonly branch: string }
  | { readonly kind: 'merge_request_url'; readonly url: string }
  | { readonly kind: 'pull_request_url'; readonly url: string }
  | { readonly kind: 'clipboard_diff'; readonly diff: string };

/** A normalized, platform-internal representation of what to review. */
export interface ReviewInput {
  readonly repositoryId: RepositoryId;
  readonly kind: ReviewInputKind;
  /** Present when the input resolves to a diff/patch. */
  readonly diff?: string;
  readonly commitHash?: string;
  readonly branch?: string;
  /** Present when the input resolves to a provider change request. */
  readonly changeRequest?: ChangeRequestRef;
}

/** A file entry within a repository snapshot. */
export interface RepositoryFile {
  readonly path: string;
  readonly size: number;
}

/**
 * Abstraction over a checked-out/accessible repository. Implementations live in
 * `repository`; they may be backed by local FS, a clone, or a provider API.
 */
export interface Repository {
  readonly id: RepositoryId;
  readFile(path: string): AsyncResult<string>;
  listFiles(globs?: readonly string[]): AsyncResult<readonly RepositoryFile[]>;
  getDiff(): AsyncResult<string | undefined>;
}

/** Normalizes any `ReviewInputSource` into a `ReviewInput`. */
export interface InputResolver {
  readonly kind: ReviewInputKind;
  resolve(source: ReviewInputSource): AsyncResult<ReviewInput>;
}

/** Registry of input resolvers; new input methods register here. */
export interface InputResolverRegistry {
  register(resolver: InputResolver): void;
  get(kind: ReviewInputKind): InputResolver | undefined;
}
