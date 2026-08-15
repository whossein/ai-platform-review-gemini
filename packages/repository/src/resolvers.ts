/**
 * Input resolvers (Phase 7).
 *
 * Each supported input method normalizes a raw `ReviewInputSource` into the
 * uniform `ReviewInput` the rest of the platform consumes. New input methods
 * register here without touching callers (ADR-0002). This file implements the
 * offline-capable resolvers: local folder, git diff, patch file, and clipboard
 * diff. Git-clone / commit / branch / MR-URL resolvers implement the same
 * contract and are added in the git-integration phase.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  AsyncResult,
  InputResolver,
  InputResolverRegistry,
  PlatformError,
  RepositoryId,
  ReviewInput,
  ReviewInputKind,
  ReviewInputSource,
} from '@ai-review/core';
import { showCommitDiff, branchDiff, type GitRunner, systemGitRunner } from './local-git.js';
import { systemClipboardReader, type ClipboardReader } from './clipboard.js';

function fail(code: string, message: string, cause?: unknown): { ok: false; error: PlatformError } {
  return {
    ok: false,
    error: { category: 'io', code, message, ...(cause !== undefined ? { cause } : {}) },
  };
}

/** Map-backed resolver registry (last write wins per kind). */
export class MapInputResolverRegistry implements InputResolverRegistry {
  private readonly resolvers = new Map<ReviewInputKind, InputResolver>();

  register(resolver: InputResolver): void {
    this.resolvers.set(resolver.kind, resolver);
  }

  get(kind: ReviewInputKind): InputResolver | undefined {
    return this.resolvers.get(kind);
  }
}

/** `local_folder` → a repository id + (optional) working diff. */
export class LocalFolderResolver implements InputResolver {
  readonly kind = 'local_folder' as const;

  async resolve(source: ReviewInputSource): AsyncResult<ReviewInput> {
    if (source.kind !== 'local_folder') {
      return fail('resolver.kind_mismatch', `expected local_folder, got "${source.kind}"`);
    }
    const abs = resolve(source.path);
    return {
      ok: true,
      value: { repositoryId: abs as RepositoryId, kind: 'local_folder' },
    };
  }
}

/** `git_diff` / `clipboard_diff` → a `ReviewInput` carrying the raw diff. */
export class DiffResolver implements InputResolver {
  readonly kind: ReviewInputKind;

  constructor(kind: 'git_diff' | 'clipboard_diff' = 'git_diff') {
    this.kind = kind;
  }

  async resolve(source: ReviewInputSource): AsyncResult<ReviewInput> {
    if (source.kind !== 'git_diff' && source.kind !== 'clipboard_diff') {
      return fail('resolver.kind_mismatch', `expected a diff source, got "${source.kind}"`);
    }
    if (source.diff.trim().length === 0) {
      return fail('resolver.empty_diff', 'diff input is empty');
    }
    return {
      ok: true,
      value: {
        repositoryId: 'diff' as RepositoryId,
        kind: source.kind,
        diff: source.diff,
      },
    };
  }
}

/** `patch_file` → reads a `.patch`/`.diff` file from disk into a diff input. */
export class PatchFileResolver implements InputResolver {
  readonly kind = 'patch_file' as const;

  async resolve(source: ReviewInputSource): AsyncResult<ReviewInput> {
    if (source.kind !== 'patch_file') {
      return fail('resolver.kind_mismatch', `expected patch_file, got "${source.kind}"`);
    }
    try {
      const diff = await readFile(resolve(source.path), 'utf8');
      if (diff.trim().length === 0) {
        return fail('resolver.empty_patch', `patch file is empty: "${source.path}"`);
      }
      return {
        ok: true,
        value: { repositoryId: 'patch' as RepositoryId, kind: 'patch_file', diff },
      };
    } catch (cause) {
      return fail('resolver.patch_read_failed', `failed to read patch "${source.path}"`, cause);
    }
  }
}

/** `clipboard_diff` → reads the diff from the system clipboard. */
export class ClipboardResolver implements InputResolver {
  readonly kind = 'clipboard_diff' as const;

  constructor(private readonly read: ClipboardReader = systemClipboardReader) {}

  async resolve(source: ReviewInputSource): AsyncResult<ReviewInput> {
    if (source.kind !== 'clipboard_diff') {
      return fail('resolver.kind_mismatch', `expected clipboard_diff, got "${source.kind}"`);
    }
    // A caller may pre-fill `diff`; otherwise pull it from the clipboard now.
    let diff = source.diff;
    if (!diff || diff.trim().length === 0) {
      try {
        diff = await this.read();
      } catch (cause) {
        return fail('resolver.clipboard_read_failed', 'failed to read the system clipboard', cause);
      }
    }
    if (diff.trim().length === 0) {
      return fail('resolver.empty_clipboard', 'clipboard is empty');
    }
    return {
      ok: true,
      value: { repositoryId: 'clipboard' as RepositoryId, kind: 'clipboard_diff', diff },
    };
  }
}

/** `commit` → resolves a commit-ish in a local repo to the diff it introduced. */
export class CommitResolver implements InputResolver {
  readonly kind = 'commit' as const;

  constructor(private readonly run: GitRunner = systemGitRunner) {}

  async resolve(source: ReviewInputSource): AsyncResult<ReviewInput> {
    if (source.kind !== 'commit') {
      return fail('resolver.kind_mismatch', `expected commit, got "${source.kind}"`);
    }
    try {
      const diff = await showCommitDiff(source.commitHash, source.repo, this.run);
      if (diff.trim().length === 0) {
        return fail('resolver.empty_commit', `commit produced no diff: "${source.commitHash}"`);
      }
      return {
        ok: true,
        value: {
          repositoryId: resolve(source.repo) as RepositoryId,
          kind: 'commit',
          diff,
          commitHash: source.commitHash,
        },
      };
    } catch (cause) {
      return fail('resolver.commit_failed', `failed to diff commit "${source.commitHash}"`, cause);
    }
  }
}

/** `branch` → resolves a branch's own changes (merge-base diff vs its base). */
export class BranchResolver implements InputResolver {
  readonly kind = 'branch' as const;

  constructor(
    private readonly run: GitRunner = systemGitRunner,
    /** Optional base branch override; auto-detected when omitted. */
    private readonly base?: string,
  ) {}

  async resolve(source: ReviewInputSource): AsyncResult<ReviewInput> {
    if (source.kind !== 'branch') {
      return fail('resolver.kind_mismatch', `expected branch, got "${source.kind}"`);
    }
    try {
      const diff = await branchDiff(source.branch, source.repo, this.base, this.run);
      if (diff.trim().length === 0) {
        return fail('resolver.empty_branch', `branch has no changes vs base: "${source.branch}"`);
      }
      return {
        ok: true,
        value: {
          repositoryId: resolve(source.repo) as RepositoryId,
          kind: 'branch',
          diff,
          branch: source.branch,
        },
      };
    } catch (cause) {
      return fail('resolver.branch_failed', `failed to diff branch "${source.branch}"`, cause);
    }
  }
}

/**
 * Registers every offline/local-capable resolver into a registry: local folder,
 * git diff, clipboard diff, patch file, commit, and branch. Provider-API
 * resolvers (merge/pull request URLs) are registered by the `git` layer, which
 * owns the HTTP clients and tokens.
 */
export function registerDefaultResolvers(registry: InputResolverRegistry): void {
  registry.register(new LocalFolderResolver());
  registry.register(new DiffResolver('git_diff'));
  registry.register(new ClipboardResolver());
  registry.register(new PatchFileResolver());
  registry.register(new CommitResolver());
  registry.register(new BranchResolver());
}
