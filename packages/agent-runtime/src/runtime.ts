/**
 * Agent runtime (ADR-0003).
 *
 * Executes a registered agent within its declared constraints. The runtime is
 * the single choke point that enforces:
 *   1. existence          — the agent must be registered;
 *   2. budget             — refuse to start if the budget is already exhausted;
 *   3. capability gating  — an agent may only use tools/skills in its allow-list;
 *   4. structured output  — results must be well-formed (ADR-0008).
 *
 * Business reasoning lives in agent handlers; policy lives here. Keeping the two
 * separate is what lets us add agents as data without touching the engine.
 */

import type {
  AgentExecutionContext,
  AgentHandler,
  AgentId,
  AgentRegistry,
  AgentResult,
  AgentRuntime,
  AsyncResult,
  PlatformError,
  SkillAccessor,
  SkillId,
  SkillInput,
  ToolAccessor,
  ToolId,
  ToolInvocation,
} from '@ai-review/core';

function fail(
  category: PlatformError['category'],
  code: string,
  message: string,
  details?: Record<string, unknown>,
): { ok: false; error: PlatformError } {
  const error: PlatformError =
    details === undefined ? { category, code, message } : { category, code, message, details };
  return { ok: false, error };
}

/**
 * Wraps the raw tool/skill accessors so an agent can only reach the capabilities
 * declared in its definition. The accessor carries the target id in its payload
 * (`toolId` / `skillId`); we intercept there and refuse anything off the
 * allow-list. `available()` is filtered too, so an agent cannot even discover
 * capabilities it may not use.
 */
function gateCapabilities(
  ctx: AgentExecutionContext,
  allowedTools: readonly ToolId[],
  allowedSkills: readonly SkillId[],
): AgentExecutionContext {
  const toolAllow = new Set<string>(allowedTools);
  const skillAllow = new Set<string>(allowedSkills);

  const gatedTools: ToolAccessor = {
    invoke: (invocation: ToolInvocation) => {
      if (!toolAllow.has(invocation.toolId)) {
        return Promise.resolve(
          fail(
            'unauthorized',
            'agent.tool_denied',
            `capability denied: tool "${invocation.toolId}" not in agent allow-list`,
          ),
        );
      }
      return ctx.tools.invoke(invocation);
    },
    available: () => ctx.tools.available().filter((d) => toolAllow.has(d.id)),
  };

  const gatedSkills: SkillAccessor = {
    execute: (input: SkillInput) => {
      if (!skillAllow.has(input.skillId)) {
        return Promise.resolve(
          fail(
            'unauthorized',
            'agent.skill_denied',
            `capability denied: skill "${input.skillId}" not in agent allow-list`,
          ),
        );
      }
      return ctx.skills.execute(input);
    },
    available: () => ctx.skills.available().filter((d) => skillAllow.has(d.id)),
  };

  return { ...ctx, tools: gatedTools, skills: gatedSkills };
}

/** Validates the shape/ranges the whole trust pipeline depends on. */
function validateResult(id: AgentId, result: AgentResult): PlatformError | undefined {
  if (result.agentId !== id) {
    return {
      category: 'validation',
      code: 'agent.result.id_mismatch',
      message: `result.agentId "${result.agentId}" does not match executed agent "${id}"`,
    };
  }
  if (result.confidence < 0 || result.confidence > 1 || Number.isNaN(result.confidence)) {
    return {
      category: 'validation',
      code: 'agent.result.confidence_range',
      message: `confidence must be within [0,1], received ${result.confidence}`,
    };
  }
  for (const issue of result.issues) {
    if (issue.confidence < 0 || issue.confidence > 1 || Number.isNaN(issue.confidence)) {
      return {
        category: 'validation',
        code: 'agent.issue.confidence_range',
        message: `issue "${issue.id}" confidence out of range: ${issue.confidence}`,
      };
    }
    if (issue.producedBy !== id) {
      return {
        category: 'validation',
        code: 'agent.issue.provenance',
        message: `issue "${issue.id}" claims producer "${issue.producedBy}" but was emitted by "${id}"`,
      };
    }
  }
  return undefined;
}

export class DefaultAgentRuntime implements AgentRuntime {
  constructor(private readonly registry: AgentRegistry) {}

  async execute(id: AgentId, ctx: AgentExecutionContext): AsyncResult<AgentResult> {
    const registered = this.registry.get(id);
    if (!registered) {
      return fail('not_found', 'agent.not_found', `no agent registered with id "${id}"`);
    }

    // A purely declarative agent (prompt-only, no handler) is a valid concept but
    // cannot be executed by this runtime alone — the workflow's LLM stage drives
    // those. Here we require an executable handler.
    const handler: AgentHandler | undefined = registered.handler;
    if (!handler) {
      return fail(
        'internal',
        'agent.no_handler',
        `agent "${id}" is declarative-only and has no executable handler`,
      );
    }

    // Refuse to even start if the budget is already exhausted (fail fast, cheap).
    const status = ctx.budget.status();
    if (status.exceeded.length > 0) {
      return fail(
        'budget_exceeded',
        'agent.budget_exhausted',
        `budget exceeded before "${id}" ran`,
        { exceeded: status.exceeded },
      );
    }

    const { allowedTools, allowedSkills } = registered.definition;
    const gatedCtx = gateCapabilities(ctx, allowedTools, allowedSkills);

    let result: AgentResult;
    try {
      const outcome = await handler.run(gatedCtx);
      if (!outcome.ok) return outcome;
      result = outcome.value;
    } catch (cause) {
      // Unexpected throws are normalized to errors so callers never have to
      // try/catch across the contract boundary.
      return {
        ok: false,
        error: {
          category: 'internal',
          code: 'agent.handler_threw',
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        },
      };
    }

    const invalid = validateResult(id, result);
    if (invalid) return { ok: false, error: invalid };

    return { ok: true, value: result };
  }
}
