/**
 * Rule Engine tests (ADR-0006): deterministic checks run before AI, are free,
 * and report covered concerns so the Planner can trim redundant LLM work.
 */

import { describe, it, expect } from 'vitest';
import { DefaultRuleEngine, MapRuleRegistry, DEFAULT_RULES, ruleFindingToIssue } from './index.js';
import type { FileRuleContext } from './rules.js';

function engineWithDefaults(): DefaultRuleEngine {
  const registry = new MapRuleRegistry();
  for (const rule of DEFAULT_RULES) registry.register(rule);
  return new DefaultRuleEngine(registry);
}

const CTX: FileRuleContext = {
  repositoryId: 'repo.test',
  files: [
    {
      path: 'src/bad.ts',
      text: [
        'const API_KEY = "sk-live-abcdef123456";',
        'function f(x: any) {',
        '  console.log(x);',
        '  return x; // TODO: fix later',
        '}',
      ].join('\n'),
    },
  ],
};

describe('DefaultRuleEngine', () => {
  it('detects secret, any, console, and TODO deterministically', async () => {
    const engine = engineWithDefaults();
    const res = await engine.run(CTX);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const ruleIds = res.value.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain('secret.hardcoded');
    expect(ruleIds).toContain('no-explicit-any');
    expect(ruleIds).toContain('no-console');
    expect(ruleIds).toContain('no-todo-comment');
  });

  it('reports covered concerns for planner suppression', async () => {
    const engine = engineWithDefaults();
    const res = await engine.run(CTX);
    if (!res.ok) return;
    expect(res.value.coveredConcerns).toContain('secret_detection');
    expect(res.value.coveredConcerns).toContain('typescript');
  });

  it('finds nothing in clean code', async () => {
    const engine = engineWithDefaults();
    const res = await engine.run({
      repositoryId: 'r',
      files: [{ path: 'ok.ts', text: 'export const sum = (a: number, b: number) => a + b;' }],
    } as FileRuleContext);
    expect(res.ok && res.value.findings).toHaveLength(0);
  });

  it('lifts a finding into a canonical Issue with confidence 1.0', async () => {
    const engine = engineWithDefaults();
    const res = await engine.run(CTX);
    if (!res.ok) return;
    const secret = res.value.findings.find((f) => f.ruleId === 'secret.hardcoded')!;
    const issue = ruleFindingToIssue(secret);
    expect(issue.confidence).toBe(1);
    expect(issue.category).toBe('security');
    expect(issue.severity).toBe('high');
    expect(issue.fingerprint.length).toBeGreaterThan(0);
  });
});
