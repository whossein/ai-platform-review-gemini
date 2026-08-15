/**
 * @ai-review/repository
 *
 * Repository access + input normalization (Phase 7):
 *  - `LocalFolderRepository`     — read/list files from disk, path-confined.
 *  - `MapInputResolverRegistry`  — dynamic registry of input resolvers.
 *  - `LocalFolderResolver` · `DiffResolver` · `PatchFileResolver` ·
 *    `ClipboardResolver` · `CommitResolver` · `BranchResolver` — offline/local
 *    resolvers for local folder, git/clipboard diff, patch files, a single
 *    commit, and a branch's own changes.
 *  - `showCommitDiff` · `branchDiff` — injectable local-git helpers.
 *  - `systemClipboardReader`     — cross-platform clipboard reader.
 *  - `parseUnifiedDiff`          — minimal unified-diff parser used to detect
 *    changed lines/symbols (feeds the Context Engine).
 *
 * MR/PR-URL resolvers implement the same contracts and are provided by the
 * `git` layer (which owns HTTP clients + tokens), without caller changes.
 */

export { LocalFolderRepository } from './local-repository.js';
export type { LocalRepositoryOptions } from './local-repository.js';
export {
  MapInputResolverRegistry,
  LocalFolderResolver,
  DiffResolver,
  PatchFileResolver,
  ClipboardResolver,
  CommitResolver,
  BranchResolver,
  registerDefaultResolvers,
} from './resolvers.js';
export { showCommitDiff, branchDiff, systemGitRunner, type GitRunner } from './local-git.js';
export { systemClipboardReader, type ClipboardReader } from './clipboard.js';
export { parseUnifiedDiff } from './diff.js';
export type { ParsedFileDiff } from './diff.js';
