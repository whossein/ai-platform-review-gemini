/**
 * Input-method resolver tests (Phase 7).
 *
 * These cover the newly wired input methods — commit, branch, and clipboard —
 * using injected runners/readers so no real git repo or clipboard is touched.
 */

import { describe, it, expect } from 'vitest';
import { CommitResolver, BranchResolver, ClipboardResolver } from './resolvers.js';
import type { GitRunner } from './local-git.js';

const SAMPLE = `diff --git a/a.ts b/a.ts\n+const x: any = 1;\n`;

describe('CommitResolver', () => {
  it('resolves a commit-ish to the diff it introduced', async () => {
    const run: GitRunner = async (args) => {
      expect(args[0]).toBe('show');
      expect(args).toContain('abc123');
      return SAMPLE;
    };
    const res = await new CommitResolver(run).resolve({
      kind: 'commit',
      repo: '/tmp/repo',
      commitHash: 'abc123',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.kind).toBe('commit');
      expect(res.value.commitHash).toBe('abc123');
      expect(res.value.diff).toContain('const x: any');
    }
  });

  it('fails when the commit produces no diff', async () => {
    const run: GitRunner = async () => '   \n';
    const res = await new CommitResolver(run).resolve({
      kind: 'commit',
      repo: '/tmp/repo',
      commitHash: 'HEAD',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('resolver.empty_commit');
  });

  it('surfaces git errors as a failed result', async () => {
    const run: GitRunner = async () => {
      throw new Error('bad revision');
    };
    const res = await new CommitResolver(run).resolve({
      kind: 'commit',
      repo: '/tmp/repo',
      commitHash: 'nope',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('resolver.commit_failed');
  });
});

describe('BranchResolver', () => {
  it('diffs a branch against an explicit base using the three-dot form', async () => {
    const run: GitRunner = async (args) => {
      expect(args[0]).toBe('diff');
      expect(args).toContain('main...feature/login');
      return SAMPLE;
    };
    const res = await new BranchResolver(run, 'main').resolve({
      kind: 'branch',
      repo: '/tmp/repo',
      branch: 'feature/login',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.kind).toBe('branch');
      expect(res.value.branch).toBe('feature/login');
    }
  });

  it('auto-detects the base branch when none is given', async () => {
    const seen: string[][] = [];
    const run: GitRunner = async (args) => {
      seen.push([...args]);
      if (args[0] === 'rev-parse') {
        // origin/main verifies successfully.
        if (args.includes('origin/main')) return 'ok\n';
        throw new Error('unknown revision');
      }
      return SAMPLE;
    };
    const res = await new BranchResolver(run).resolve({
      kind: 'branch',
      repo: '/tmp/repo',
      branch: 'topic',
    });
    expect(res.ok).toBe(true);
    // The diff call must have used the detected base.
    const diffCall = seen.find((a) => a[0] === 'diff');
    expect(diffCall?.some((a) => a.includes('origin/main...topic'))).toBe(true);
  });
});

describe('ClipboardResolver', () => {
  it('reads the diff from the injected clipboard reader', async () => {
    const res = await new ClipboardResolver(async () => SAMPLE).resolve({
      kind: 'clipboard_diff',
      diff: '',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.diff).toContain('const x: any');
  });

  it('prefers a pre-filled diff over reading the clipboard', async () => {
    let read = false;
    const res = await new ClipboardResolver(async () => {
      read = true;
      return 'SHOULD-NOT-BE-USED';
    }).resolve({ kind: 'clipboard_diff', diff: SAMPLE });
    expect(res.ok).toBe(true);
    expect(read).toBe(false);
  });

  it('fails cleanly when the clipboard read throws', async () => {
    const res = await new ClipboardResolver(async () => {
      throw new Error('no clipboard');
    }).resolve({ kind: 'clipboard_diff', diff: '' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('resolver.clipboard_read_failed');
  });
});
