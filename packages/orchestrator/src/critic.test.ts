import { describe, it, expect } from 'vitest';
import { critique } from './critic.js';
import type { AgentId, ContentHash, Issue, IssueId, Severity } from '@ai-review/core';

interface IssueInput {
  readonly id?: string;
  readonly producedBy: string;
  readonly severity?: Severity;
  readonly confidence?: number;
  readonly category?: string;
  readonly location?: { readonly file: string; readonly line?: number };
}

function issue(input: IssueInput): Issue {
  return {
    id: (input.id ?? 'i.1') as IssueId,
    title: 'Hardcoded secret',
    description: 'desc',
    severity: input.severity ?? 'high',
    confidence: input.confidence ?? 0.6,
    reason: 'because',
    suggestion: { description: 'fix it' },
    location: input.location ?? { file: 'src/a.ts', line: 1 },
    references: [],
    category: input.category ?? 'security',
    producedBy: input.producedBy as AgentId,
    fingerprint: 'abc' as ContentHash,
  };
}

describe('critic / consolidation', () => {
  it('merges duplicate findings at the same file+line+category into one', () => {
    const out = critique([
      issue({ id: 'a', producedBy: 'agent.security-reviewer' }),
      issue({ id: 'b', producedBy: 'agent.code-reviewer' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.corroboratedBy).toHaveLength(2);
  });

  it('boosts confidence when reviewers corroborate, never exceeding 1', () => {
    const out = critique([
      issue({ id: 'a', confidence: 0.6, producedBy: 'agent.security-reviewer' }),
      issue({ id: 'b', confidence: 0.6, producedBy: 'agent.code-reviewer' }),
    ]);
    expect(out[0]!.confidence).toBeGreaterThan(0.6);
    expect(out[0]!.confidence).toBeLessThanOrEqual(1);
  });

  it('keeps the highest severity as the representative', () => {
    const out = critique([
      issue({ id: 'a', severity: 'low', producedBy: 'agent.code-reviewer' }),
      issue({ id: 'b', severity: 'critical', producedBy: 'agent.security-reviewer' }),
    ]);
    expect(out[0]!.severity).toBe('critical');
  });

  it('does not merge findings at different locations', () => {
    const out = critique([
      issue({ id: 'a', location: { file: 'src/a.ts', line: 1 }, producedBy: 'x' }),
      issue({ id: 'b', location: { file: 'src/a.ts', line: 9 }, producedBy: 'y' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('leaves a single-agent finding unchanged in confidence', () => {
    const out = critique([issue({ id: 'a', confidence: 0.72, producedBy: 'solo' })]);
    expect(out[0]!.confidence).toBe(0.72);
    expect(out[0]!.corroboratedBy).toEqual(['solo']);
  });
});
