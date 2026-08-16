/**
 * End-to-end review test (composition root).
 *
 * Exercises the full vertical slice with zero external services: diff → shared
 * context slice → specialist agents (via the runtime) → Judge → Markdown/JSON.
 * This is the "does the whole thing actually run?" guardrail.
 */

import { describe, it, expect } from 'vitest';
import type { LLMClient, ModelId } from '@ai-review/core';
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

  it('skips agent stages when pre-execution budget reservation cannot be made', async () => {
    // A tiny token budget of 10 tokens cannot cover the estimated reservation (~1000 tokens)
    const result = await runReview({
      diff: DIFF,
      budget: { tokenBudget: 10, dollarBudget: 1, executionBudgetMs: 30000 },
    });

    expect(result.errors.some((e) => e.message.includes('Budget reservation denied'))).toBe(true);
    expect(result.total).toBe(0);
  });

  it('retries transient errors up to maxRetries and succeeds if a later attempt succeeds', async () => {
    let callCount = 0;
    const flakyLlm: LLMClient = {
      complete: async () => {
        callCount++;
        // First 2 calls fail with transient 429 rate limit
        if (callCount <= 2) {
          return {
            ok: false,
            error: {
              category: 'provider',
              code: 'llm.rate_limited',
              message: 'Rate limit exceeded (429)',
              retryable: true,
            },
          };
        }
        // Subsequent calls succeed with valid findings
        return {
          ok: true,
          value: {
            content: JSON.stringify({
              issues: [
                {
                  title: 'Transient test issue',
                  description: 'Found after retry',
                  severity: 'high',
                  confidence: 0.9,
                  file: 'src/UserList.tsx',
                  line: 1,
                },
              ],
              confidence: 0.9,
            }),
            model: 'mock.model' as ModelId,
            finishReason: 'stop',
            usage: { promptTokens: 100, completionTokens: 50 },
          },
        };
      },
    };

    const result = await runReview({
      diff: DIFF,
      llm: flakyLlm,
      selectedSpecialists: ['Security Reviewer'],
      maxRetries: 3,
    });

    expect(callCount).toBeGreaterThan(1);
    expect(result.accepted).toBeGreaterThan(0);
    expect(result.errors.length).toBe(0);
  });

  it('fails fast without retry on non-transient validation/auth errors', async () => {
    let callCount = 0;
    const authFailLlm: LLMClient = {
      complete: async () => {
        callCount++;
        return {
          ok: false,
          error: {
            category: 'unauthorized',
            code: 'llm.invalid_api_key',
            message: 'Invalid API Key (401)',
            retryable: false,
          },
        };
      },
    };

    const result = await runReview({
      diff: DIFF,
      llm: authFailLlm,
      selectedSpecialists: ['Security Reviewer'],
      maxRetries: 3,
    });

    // Should only be called once because 401/unauthorized is non-retryable
    expect(callCount).toBe(1);
    expect(result.errors.some((e) => e.message.includes('Invalid API Key'))).toBe(true);
  });
});

