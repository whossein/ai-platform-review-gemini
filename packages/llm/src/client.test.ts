/**
 * LLM layer tests.
 *
 * Prove the provider-agnostic contract (ADR-0007): the cheapest capable model is
 * selected, unknown-capability requests fail cleanly, and the mock provider
 * returns structured JSON findings from a diff without spending tokens.
 */

import { describe, it, expect } from 'vitest';
import type { Budget, LLMProvider, ModelDescriptor, ModelId, ProviderId } from '@ai-review/core';
import { MockLLMProvider, CheapestFirstRouter, RoutingLLMClient } from './index.js';

const BUDGET: Budget = { tokenBudget: 1000, dollarBudget: 1, executionBudgetMs: 60000 };

/** A fake premium provider so routing has something more expensive to reject. */
class PremiumProvider implements LLMProvider {
  readonly id = 'provider.premium' as ProviderId;
  models(): readonly ModelDescriptor[] {
    return [
      {
        id: 'premium.model' as ModelId,
        provider: this.id,
        tier: 'premium',
        capabilities: ['text', 'json_mode'],
        contextWindow: 200_000,
        inputCostPer1M: 15,
        outputCostPer1M: 75,
      },
    ];
  }
  async complete() {
    return {
      ok: true as const,
      value: {
        model: 'premium.model' as ModelId,
        content: '{}',
        usage: { promptTokens: 1, completionTokens: 1 },
        finishReason: 'stop' as const,
      },
    };
  }
}

describe('CheapestFirstRouter', () => {
  it('selects the cheapest capable model (mock/local wins over premium)', async () => {
    const router = new CheapestFirstRouter([new MockLLMProvider(), new PremiumProvider()]);
    const res = await router.select({
      requiredCapabilities: ['text', 'json_mode'],
      budget: BUDGET,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.tier).toBe('local');
  });

  it('fails when no model satisfies the required capabilities', async () => {
    const router = new CheapestFirstRouter([new MockLLMProvider()]);
    const res = await router.select({ requiredCapabilities: ['vision'], budget: BUDGET });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('llm.no_capable_model');
  });
});

describe('MockLLMProvider (via RoutingLLMClient)', () => {
  it('detects a hardcoded secret in an added diff line and returns JSON', async () => {
    const provider = new MockLLMProvider();
    const client = new RoutingLLMClient([provider], new CheapestFirstRouter([provider]), {
      requiredCapabilities: ['text', 'json_mode'],
      budget: BUDGET,
    });
    const diff = [
      '+++ b/config.ts',
      '@@ -0,0 +1 @@',
      '+const apiKey = "supersecretvalue123";',
    ].join('\n');
    const res = await client.complete({
      messages: [
        { role: 'system', content: 'FOCUS:security' },
        { role: 'user', content: diff },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.value.content) as { issues: { category: string }[] };
      expect(parsed.issues.length).toBeGreaterThan(0);
      expect(parsed.issues[0]?.category).toBe('security');
      // Deterministic + free.
      expect(res.value.usage.completionTokens).toBeGreaterThan(0);
    }
  });

  it('reports no issues for a clean diff', async () => {
    const provider = new MockLLMProvider();
    const client = new RoutingLLMClient([provider], new CheapestFirstRouter([provider]), {
      requiredCapabilities: ['text', 'json_mode'],
      budget: BUDGET,
    });
    const res = await client.complete({
      messages: [
        { role: 'system', content: 'FOCUS:security' },
        { role: 'user', content: '+++ b/ok.ts\n@@ -0,0 +1 @@\n+export const x = 1;' },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.value.content) as { issues: unknown[] };
      expect(parsed.issues).toHaveLength(0);
    }
  });
});
