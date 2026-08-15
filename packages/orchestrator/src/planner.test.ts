import { describe, it, expect } from 'vitest';
import { plan, changedFiles } from './planner.js';
import { SPECIALISTS } from './agents.js';

const tsxDiff = `diff --git a/src/UserList.tsx b/src/UserList.tsx
--- a/src/UserList.tsx
+++ b/src/UserList.tsx
@@ -1,1 +1,3 @@
+export function UserList() { return <ul />; }
`;

const cssDiff = `diff --git a/src/app.css b/src/app.css
--- a/src/app.css
+++ b/src/app.css
@@ -1,1 +1,2 @@
+.title { color: red; }
`;

describe('planner / smart routing', () => {
  it('extracts changed files from git + +++ headers', () => {
    expect(changedFiles(tsxDiff)).toEqual(['src/UserList.tsx']);
  });

  it('selects the React reviewer for a TSX change', () => {
    const p = plan({ diff: tsxDiff, specialists: SPECIALISTS });
    const focuses = p.selected.map((s) => s.focus);
    expect(focuses).toContain('react');
    expect(focuses).toContain('security');
  });

  it('skips code specialists for a pure-CSS change (token saving)', () => {
    const p = plan({ diff: cssDiff, specialists: SPECIALISTS });
    // No code-shaped specialists should run for a CSS-only change.
    expect(p.selected.map((s) => s.focus)).not.toContain('react');
    expect(p.selected.map((s) => s.focus)).not.toContain('code');
    expect(p.skipped.length).toBeGreaterThan(0);
  });

  it('orders selected specialists by descending priority', () => {
    const p = plan({ diff: tsxDiff, specialists: SPECIALISTS });
    const priorities = p.selected.map((s) => s.priority);
    const sorted = [...priorities].sort((a, b) => b - a);
    expect(priorities).toEqual(sorted);
  });

  it('skips a specialist whose category is already covered by rules', () => {
    const p = plan({
      diff: tsxDiff,
      specialists: SPECIALISTS,
      coveredCategories: ['security'],
    });
    expect(p.selected.map((s) => s.focus)).not.toContain('security');
    expect(p.skipped.some((s) => s.reason.includes('deterministic rules'))).toBe(true);
  });
});
