/**
 * Provider-agnostic LLM client + router (ADR-0007).
 *
 * `RoutingLLMClient` is the high-level handle agents use. It hides model
 * selection behind `ModelRouter` and never exposes providers/models to callers.
 * `CheapestFirstRouter` picks the lowest-cost model that satisfies the required
 * capabilities — the foundation of the "start cheap, escalate only if needed"
 * cost policy.
 */

import type {
  AsyncResult,
  LLMClient,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ModelDescriptor,
  ModelId,
  ModelRouter,
  PlatformError,
  RoutingContext,
} from '@ai-review/core';

/** Selects the cheapest capable model across all registered providers. */
export class CheapestFirstRouter implements ModelRouter {
  constructor(private readonly providers: readonly LLMProvider[]) {}

  private allModels(): ModelDescriptor[] {
    return this.providers.flatMap((p) => [...p.models()]);
  }

  async select(ctx: RoutingContext): AsyncResult<ModelDescriptor> {
    const capable = this.allModels().filter((m) =>
      ctx.requiredCapabilities.every((c) => m.capabilities.includes(c)),
    );
    if (capable.length === 0) {
      return {
        ok: false,
        error: {
          category: 'provider',
          code: 'llm.no_capable_model',
          message: `no model satisfies capabilities: ${ctx.requiredCapabilities.join(', ')}`,
        },
      };
    }
    // Honor an affordable, capable preferred model when present.
    const preferred = capable.find((m) => m.id === ctx.preferredModel);
    if (preferred) return { ok: true, value: preferred };

    // Otherwise cheapest by combined per-1M cost (local/mock = 0 wins).
    const cheapest = [...capable].sort(
      (a, b) => a.inputCostPer1M + a.outputCostPer1M - (b.inputCostPer1M + b.outputCostPer1M),
    )[0]!;
    return { ok: true, value: cheapest };
  }
}

export class RoutingLLMClient implements LLMClient {
  private readonly byModel = new Map<ModelId, LLMProvider>();

  constructor(
    providers: readonly LLMProvider[],
    private readonly router: ModelRouter,
    private readonly defaultContext: Omit<RoutingContext, 'preferredModel'>,
  ) {
    for (const p of providers) {
      for (const m of p.models()) this.byModel.set(m.id, p);
    }
  }

  async complete(
    request: Omit<LLMRequest, 'model'> & { model?: ModelId },
  ): AsyncResult<LLMResponse> {
    let modelId = request.model;
    if (!modelId) {
      const selected = await this.router.select({
        ...this.defaultContext,
        ...(request.model ? { preferredModel: request.model } : {}),
      });
      if (!selected.ok) return selected;
      modelId = selected.value.id;
    }

    const provider = this.byModel.get(modelId);
    if (!provider) {
      const error: PlatformError = {
        category: 'provider',
        code: 'llm.unknown_model',
        message: `no provider serves model "${modelId}"`,
      };
      return { ok: false, error };
    }

    return provider.complete({ ...request, model: modelId });
  }
}
