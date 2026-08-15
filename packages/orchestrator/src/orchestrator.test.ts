/**
 * End-to-end review test (composition root).
 *
 * Exercises the full vertical slice with zero external services: diff → shared
 * context slice → specialist agents (via the runtime) → Judge → Markdown/JSON.
 * This is the "does the whole thing actually run?" guardrail.
 */

import { describe, it, expect } from 'vitest';
import type { LLMClient } from '@ai-review/core';
import { runReview } from './orchestrator.js';

const DIFF = [
  '+++ b/src/UserList.tsx',
  '@@ -0,0 +1,6 @@',
  '+const API_KEY = "sk-live-abcdef123456";',
  '+export function UserList({ users }: { users: any }) {',
  '+  console.log("rendering", users);',
  '+  return <ul>{users.map((u) => <li>{u.name}</li>)}</ul>;',
  '+}',
].join('\n');

describe('runReview (end-to-end)', () => {
  it('finds security, code, and react issues in a diff and renders reports', async () => {
    const result = await runReview({ diff: DIFF });

    expect(result.total).toBeGreaterThan(0);
    expect(result.accepted).toBeGreaterThan(0);

    // Markdown report is human-readable and leads with the highest-rank issue.
    expect(result.markdown).toContain('# AI Code Review');
    expect(result.markdown).toContain('Hardcoded secret');

    // JSON report is valid and machine-readable.
    const parsed = JSON.parse(result.json) as { issues: { category: string }[] };
    const categories = new Set(parsed.issues.map((i) => i.category));
    expect(categories.has('security')).toBe(true);
  });

  it('accepts nothing on a clean diff', async () => {
    const clean = '+++ b/ok.ts\n@@ -0,0 +1 @@\n+export const answer = 42;';
    const result = await runReview({ diff: clean });
    expect(result.accepted).toBe(0);
  });

  it('honors the confidence threshold (higher threshold rejects low-confidence findings)', async () => {
    const low = await runReview({ diff: DIFF, confidenceThreshold: 0.5 });
    const high = await runReview({ diff: DIFF, confidenceThreshold: 0.85 });
    expect(high.accepted).toBeLessThanOrEqual(low.accepted);
  });

  it('keeps partial findings when agents cannot run', async () => {
    const failingLlm: LLMClient = {
      complete: async () => ({
        ok: false,
        error: {
          category: 'provider',
          code: 'llm.budget_exhausted',
          message: 'AI budget exhausted',
        },
      }),
    };

    const result = await runReview({
      diff: DIFF,
      llm: failingLlm,
      files: [
        {
          path: 'src/UserList.tsx',
          text: [
            'const API_KEY = "sk-live-abcdef123456";',
            'export function UserList({ users }: { users: any }) {',
            '  console.log("rendering", users);',
            '  return <ul>{users.map((u) => <li>{u.name}</li>)}</ul>;',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.accepted).toBeGreaterThan(0);
    expect(result.markdown).toContain('agent(s) failed');
    expect(result.issues.some((i) => i.title === 'secret.hardcoded')).toBe(true);
  });
});
