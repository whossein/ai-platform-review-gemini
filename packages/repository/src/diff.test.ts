/**
 * Diff parser + resolver tests (Phase 7).
 */

import { describe, it, expect } from 'vitest';
import type { ReviewInputSource } from '@ai-review/core';
import { parseUnifiedDiff } from './diff.js';
import { DiffResolver, LocalFolderResolver, MapInputResolverRegistry } from './resolvers.js';
import { LocalFolderRepository } from './local-repository.js';

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,4 @@',
  ' const keep = 1;',
  '+const added = 2;',
  '+console.log(added);',
  '-const removed = 3;',
  'diff --git a/src/b.ts b/src/b.ts',
  'new file mode 100644',
  '+++ b/src/b.ts',
  '@@ -0,0 +1 @@',
  '+export const brandNew = true;',
].join('\n');

describe('parseUnifiedDiff', () => {
  it('extracts per-file added lines with correct new-file line numbers', () => {
    const files = parseUnifiedDiff(DIFF);
    expect(files).toHaveLength(2);

    const a = files.find((f) => f.path === 'src/a.ts')!;
    // ' const keep' is line 1 (context), '+const added' is line 2, '+console.log' is line 3.
    expect(a.addedLines).toEqual([2, 3]);
    expect(a.addedText.get(2)).toBe('const added = 2;');
    expect(a.added).toBe(false);

    const b = files.find((f) => f.path === 'src/b.ts')!;
    expect(b.added).toBe(true);
    expect(b.addedLines).toEqual([1]);
  });

  it('handles a bare diff with no `diff --git` header', () => {
    const bare = '+++ b/x.ts\n@@ -0,0 +1 @@\n+export const x = 1;';
    const files = parseUnifiedDiff(bare);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('x.ts');
    expect(files[0]?.addedLines).toEqual([1]);
  });
});

describe('input resolvers', () => {
  it('normalizes a git_diff source into a ReviewInput carrying the diff', async () => {
    const registry = new MapInputResolverRegistry();
    registry.register(new DiffResolver('git_diff'));
    const source: ReviewInputSource = { kind: 'git_diff', diff: DIFF };
    const resolver = registry.get('git_diff')!;
    const res = await resolver.resolve(source);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.kind).toBe('git_diff');
      expect(res.value.diff).toContain('brandNew');
    }
  });

  it('rejects an empty diff', async () => {
    const res = await new DiffResolver('git_diff').resolve({ kind: 'git_diff', diff: '   ' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('resolver.empty_diff');
  });

  it('resolves a local folder to an absolute repository id', async () => {
    const res = await new LocalFolderResolver().resolve({ kind: 'local_folder', path: '.' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.kind).toBe('local_folder');
  });
});

describe('LocalFolderRepository', () => {
  it('lists its own source files and matches `**/*.ts` including top-level files', async () => {
    // This package's own src/ is a convenient, always-present fixture.
    const repo = new LocalFolderRepository(new URL('.', import.meta.url).pathname);
    const listed = await repo.listFiles(['**/*.ts']);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      const paths = listed.value.map((f) => f.path);
      // Top-level file (no directory prefix) must match `**/*.ts`.
      expect(paths).toContain('local-repository.ts');
      expect(paths.every((p) => p.endsWith('.ts'))).toBe(true);
    }
  });

  it('reads a file it lists and refuses path traversal', async () => {
    const repo = new LocalFolderRepository(new URL('.', import.meta.url).pathname);
    const read = await repo.readFile('diff.ts');
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toContain('parseUnifiedDiff');

    const escape = await repo.readFile('../../../../etc/passwd');
    expect(escape.ok).toBe(false);
    if (!escape.ok) expect(escape.error.code).toBe('repo.path_escape');
  });
});
