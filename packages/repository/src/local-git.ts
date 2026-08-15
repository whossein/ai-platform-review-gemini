/**
 * Local git command helpers (Phase 7 — input methods).
 *
 * Thin, injectable wrappers over the `git` CLI used by the `commit` and
 * `branch` input methods. We shell out (rather than depend on a git library)
 * to keep the dependency surface tiny and to work against whatever git the
 * user already has. The runner is injectable so resolvers stay unit-testable
 * without touching a real repository.
 */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

/** Runs a git subcommand and resolves its stdout (rejects on non-zero exit). */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<string>;

/** Default runner backed by the system `git` binary. */
export const systemGitRunner: GitRunner = (args, cwd) =>
  new Promise<string>((resolvePromise, reject) => {
    execFile('git', [...args], { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolvePromise(stdout);
    });
  });

/**
 * Returns the unified diff a single commit introduced (`git show`), relative to
 * its first parent. Works for any commit-ish (hash, tag, `HEAD~2`, …).
 */
export async function showCommitDiff(
  commitish: string,
  repo: string,
  run: GitRunner = systemGitRunner,
): Promise<string> {
  // --format= suppresses the commit header so the output is a pure diff.
  return run(['show', '--no-color', '--format=', commitish], resolve(repo));
}

/**
 * Returns the diff a branch adds relative to a base branch, using the
 * three-dot form so only the branch's own changes show (merge-base diff).
 * `base` defaults to `origin/main` then falls back to `main`/`master`.
 */
export async function branchDiff(
  branch: string,
  repo: string,
  base: string | undefined,
  run: GitRunner = systemGitRunner,
): Promise<string> {
  const cwd = resolve(repo);
  const resolvedBase = base ?? (await detectDefaultBase(cwd, run));
  return run(['diff', '--no-color', `${resolvedBase}...${branch}`], cwd);
}

/** Best-effort detection of the repository's default base branch. */
async function detectDefaultBase(cwd: string, run: GitRunner): Promise<string> {
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      await run(['rev-parse', '--verify', '--quiet', candidate], cwd);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  // Last resort: diff against the empty tree so a brand-new branch still works.
  return '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
}
