/**
 * Context Engine tests (Phase 6, ADR-0004).
 *
 * Prove the core guarantees: build-once with a content-addressed handle, AST
 * extraction of imports/exports/symbols, changed-symbol detection from a diff,
 * minimal slice rendering, and budget-aware compression.
 */

import { describe, it, expect } from 'vitest';
import type { ContextHandle } from '@ai-review/core';
import { DefaultContextEngine } from './engine.js';
import { extractFile } from './ast.js';

const COMPONENT = [
  "import React from 'react';",
  "import { useState } from 'react';",
  '',
  'export function UserList({ users }: { users: string[] }) {',
  '  const [count, setCount] = useState(0);',
  '  return <ul>{users.map((u) => <li key={u}>{u}</li>)}</ul>;',
  '}',
  '',
  'export const useCounter = () => useState(0);',
].join('\n');

describe('extractFile', () => {
  it('extracts imports, exports, and classifies components/hooks', () => {
    const out = extractFile('src/UserList.tsx', COMPONENT);
    expect(out.imports).toContain('react');
    expect(out.exports).toContain('UserList');
    expect(out.exports).toContain('useCounter');

    const component = out.symbols.find((s) => s.name === 'UserList');
    expect(component?.kind).toBe('component');
    const hook = out.symbols.find((s) => s.name === 'useCounter');
    expect(hook?.kind).toBe('hook');
  });

  it('flags symbols that overlap changed lines', () => {
    // Mark line 4 (the UserList declaration) as changed.
    const out = extractFile('src/UserList.tsx', COMPONENT, new Set([4]));
    const component = out.symbols.find((s) => s.name === 'UserList');
    expect(component?.changed).toBe(true);
    const hook = out.symbols.find((s) => s.name === 'useCounter');
    expect(hook?.changed).toBe(false);
  });
});

describe('DefaultContextEngine', () => {
  it('builds shared context from files and serves a minimal slice', async () => {
    const engine = new DefaultContextEngine();
    const built = await engine.build({
      repositoryId: 'repo.test',
      files: [{ path: 'src/UserList.tsx', text: COMPONENT }],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const handle = built.value.handle;
    expect(built.value.files).toHaveLength(1);
    expect(built.value.dependencyGraph['src/UserList.tsx']).toContain('react');

    const slice = await engine.slice({ handle });
    expect(slice.ok).toBe(true);
    if (slice.ok) {
      expect(slice.value.rendered).toContain('UserList');
      expect(slice.value.rendered).toContain('imports: react');
    }
  });

  it('is idempotent by content: identical input yields the same handle', async () => {
    const engine = new DefaultContextEngine();
    const a = await engine.build({
      repositoryId: 'r',
      files: [{ path: 'a.ts', text: 'export const x = 1;' }],
    });
    const b = await engine.build({
      repositoryId: 'r',
      files: [{ path: 'a.ts', text: 'export const x = 1;' }],
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.handle).toBe(b.value.handle);
  });

  it('detects changed symbols from a diff-only build', async () => {
    const engine = new DefaultContextEngine();
    const diff = [
      'diff --git a/src/added.ts b/src/added.ts',
      'new file mode 100644',
      '+++ b/src/added.ts',
      '@@ -0,0 +1,2 @@',
      '+export function greet(name: string) {',
      '+  return `hi ${name}`;',
      '+}',
    ].join('\n');
    const built = await engine.build({ repositoryId: 'r', diff });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.changedSymbols.some((s) => s.name === 'greet')).toBe(true);
    }
  });

  it('fails a slice request for an unknown handle', async () => {
    const engine = new DefaultContextEngine();
    const slice = await engine.slice({ handle: 'ctx.missing' as ContextHandle });
    expect(slice.ok).toBe(false);
    if (!slice.ok) expect(slice.error.code).toBe('context.handle_not_found');
  });

  it('compresses to changed files when the token budget is tight', async () => {
    const engine = new DefaultContextEngine();
    const big = `export const x = ${'"'.padEnd(400, 'a')}";`;
    const built = await engine.build({
      repositoryId: 'r',
      diff: 'diff --git a/changed.ts b/changed.ts\n+++ b/changed.ts\n@@ -0,0 +1 @@\n+export const changed = 1;',
      files: [
        { path: 'changed.ts', text: 'export const changed = 1;' },
        { path: 'unchanged.ts', text: big },
      ],
    });
    if (!built.ok) throw new Error('build failed');
    const slice = await engine.slice({ handle: built.value.handle, tokenBudget: 5 });
    expect(slice.ok).toBe(true);
    if (slice.ok) expect(slice.value.compressed).toBe(true);
  });
});
