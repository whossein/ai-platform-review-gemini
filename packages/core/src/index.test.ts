/**
 * Contract smoke test.
 *
 * `core` has no runtime logic, so there is nothing behavioral to test yet. This
 * test exists to (a) prove the barrel exports are wired and importable, and
 * (b) act as a compile-time cohesion check across the domain model: if any
 * contract references a type that doesn't exist or breaks, this file fails to
 * type-check and CI catches it.
 */

import { describe, expect, it } from 'vitest';
import type { AgentDefinition, Budget, Issue, ReviewRequest, WorkflowDefinition } from './index.js';

describe('@ai-review/core contracts', () => {
  it('composes core domain types without type errors', () => {
    // Purely type-level construction; never executed as behavior.
    const budget: Budget = {
      tokenBudget: 200_000,
      dollarBudget: 1,
      executionBudgetMs: 120_000,
    };

    // A minimal, well-typed agent definition proves the contract is usable.
    const agent: Pick<AgentDefinition, 'id' | 'name' | 'confidenceThreshold'> = {
      id: 'react-reviewer' as AgentDefinition['id'],
      name: 'React Reviewer',
      confidenceThreshold: 0.7,
    };

    expect(budget.tokenBudget).toBeGreaterThan(0);
    expect(agent.confidenceThreshold).toBeLessThanOrEqual(1);

    // Reference remaining types so unused-import checks stay honest.
    const typeAnchors: readonly (Issue | ReviewRequest | WorkflowDefinition | undefined)[] = [];
    expect(typeAnchors).toHaveLength(0);
  });
});
