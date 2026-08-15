/**
 * Agent runtime tests.
 *
 * These prove the four guarantees the runtime enforces (ADR-0003 / ADR-0008):
 * existence, budget gating, capability gating, and structured-output validation.
 * All dependencies are in-memory fakes — no LLM, no network, no tokens spent.
 */

import { describe, it, expect } from 'vitest';
import type {
  AgentDefinition,
  AgentExecutionContext,
  AgentHandler,
  AgentId,
  AgentResult,
  BudgetStatus,
  ContentHash,
  IssueId,
  SkillDescriptor,
  SkillId,
  ToolDescriptor,
  ToolId,
} from '@ai-review/core';
import { MapAgentRegistry } from './registry.js';
import { DefaultAgentRuntime } from './runtime.js';

const AGENT: AgentId = 'agent.react-reviewer' as AgentId;

function makeDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: AGENT,
    name: 'React Reviewer',
    goal: 'Find React-specific issues.',
    description: 'test agent',
    systemPrompt: 'prompt.react-reviewer',
    allowedTools: ['tool.fs.read' as ToolId],
    allowedSkills: ['skill.read-symbol' as SkillId],
    outputSchema: {},
    memoryScope: 'review',
    priority: 50,
    confidenceThreshold: 0.6,
    temperature: 0.1,
    ...overrides,
  };
}

/** A budget guard whose status is fixed for the test. */
function makeBudget(exceeded: BudgetStatus['exceeded'] = []): AgentExecutionContext['budget'] {
  const status: BudgetStatus = {
    budget: { tokenBudget: 1000, dollarBudget: 1, executionBudgetMs: 60000 },
    usage: { tokensUsed: 0, dollarsSpent: 0, elapsedMs: 0 },
    remainingTokens: 1000,
    remainingDollars: 1,
    remainingMs: 60000,
    exceeded,
  };
  return {
    status: () => status,
    record: () => status,
    canAfford: () => exceeded.length === 0,
  };
}

/** Records which tools/skills were reached (for capability-gating assertions). */
function makeContext(budgetExceeded: BudgetStatus['exceeded'] = []): {
  ctx: AgentExecutionContext;
  reached: { tools: string[]; skills: string[] };
} {
  const reached = { tools: [] as string[], skills: [] as string[] };
  const toolDescriptors: ToolDescriptor[] = [
    {
      id: 'tool.fs.read' as ToolDescriptor['id'],
      name: 'fs.read',
      description: '',
      origin: 'internal',
      schema: { input: {}, output: {} },
      capabilities: ['filesystem_read'],
    },
    {
      id: 'tool.git.write' as ToolDescriptor['id'],
      name: 'git.write',
      description: '',
      origin: 'internal',
      schema: { input: {}, output: {} },
      capabilities: ['git_write'],
    },
  ];
  const skillDescriptors: SkillDescriptor[] = [
    {
      id: 'skill.read-symbol' as SkillDescriptor['id'],
      name: 'read-symbol',
      description: '',
      inputSchema: {},
      outputSchema: {},
    },
    {
      id: 'skill.publish' as SkillDescriptor['id'],
      name: 'publish',
      description: '',
      inputSchema: {},
      outputSchema: {},
    },
  ];

  const ctx: AgentExecutionContext = {
    reviewId: 'review.1',
    context: {
      slice: async () => ({
        ok: false,
        error: { category: 'internal', code: 'x', message: 'unused' },
      }),
    },
    tools: {
      invoke: async (inv) => {
        reached.tools.push(inv.toolId);
        return { ok: true, value: { output: {} } };
      },
      available: () => toolDescriptors,
    },
    skills: {
      execute: async (input) => {
        reached.skills.push(input.skillId);
        return { ok: true, value: { result: {} } };
      },
      available: () => skillDescriptors,
    },
    memory: {
      scope: 'review',
      get: async () => ({ ok: true, value: undefined }),
      set: async () => ({ ok: true, value: undefined }),
      delete: async () => ({ ok: true, value: undefined }),
    },
    // llm is unused by these handlers; a minimal stub keeps the type happy.
    llm: {} as AgentExecutionContext['llm'],
    budget: makeBudget(budgetExceeded),
  };

  return { ctx, reached };
}

function okResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return { agentId: AGENT, issues: [], confidence: 0.9, ...overrides };
}

function handlerReturning(result: AgentResult): AgentHandler {
  return { run: async () => ({ ok: true, value: result }) };
}

describe('DefaultAgentRuntime', () => {
  it('fails when the agent is not registered', async () => {
    const runtime = new DefaultAgentRuntime(new MapAgentRegistry());
    const { ctx } = makeContext();
    const res = await runtime.execute(AGENT, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('agent.not_found');
  });

  it('fails a declarative-only agent (no handler)', async () => {
    const registry = new MapAgentRegistry();
    registry.register({ definition: makeDefinition() });
    const runtime = new DefaultAgentRuntime(registry);
    const { ctx } = makeContext();
    const res = await runtime.execute(AGENT, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('agent.no_handler');
  });

  it('refuses to run when the budget is already exhausted', async () => {
    const registry = new MapAgentRegistry();
    registry.register({ definition: makeDefinition(), handler: handlerReturning(okResult()) });
    const runtime = new DefaultAgentRuntime(registry);
    const { ctx } = makeContext(['token']);
    const res = await runtime.execute(AGENT, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.category).toBe('budget_exceeded');
  });

  it('allows tools/skills on the allow-list', async () => {
    const registry = new MapAgentRegistry();
    const handler: AgentHandler = {
      run: async (c) => {
        await c.tools.invoke({ toolId: 'tool.fs.read' as ToolDescriptor['id'], input: {} });
        await c.skills.execute({ skillId: 'skill.read-symbol' as SkillDescriptor['id'], args: {} });
        return { ok: true, value: okResult() };
      },
    };
    registry.register({ definition: makeDefinition(), handler });
    const runtime = new DefaultAgentRuntime(registry);
    const { ctx, reached } = makeContext();
    const res = await runtime.execute(AGENT, ctx);
    expect(res.ok).toBe(true);
    expect(reached.tools).toContain('tool.fs.read');
    expect(reached.skills).toContain('skill.read-symbol');
  });

  it('denies tools/skills not on the allow-list and never reaches the underlying accessor', async () => {
    const registry = new MapAgentRegistry();
    const handler: AgentHandler = {
      run: async (c) => {
        const denied = await c.tools.invoke({
          toolId: 'tool.git.write' as ToolDescriptor['id'],
          input: {},
        });
        // The gate returns an error rather than throwing; the agent can react.
        expect(denied.ok).toBe(false);
        if (!denied.ok) expect(denied.error.code).toBe('agent.tool_denied');
        return { ok: true, value: okResult() };
      },
    };
    registry.register({ definition: makeDefinition(), handler });
    const runtime = new DefaultAgentRuntime(registry);
    const { ctx, reached } = makeContext();
    const res = await runtime.execute(AGENT, ctx);
    expect(res.ok).toBe(true);
    // The disallowed tool must never have hit the real accessor.
    expect(reached.tools).not.toContain('tool.git.write');
  });

  it('filters available() to the allow-list', async () => {
    const registry = new MapAgentRegistry();
    let toolsSeen: readonly string[] = [];
    let skillsSeen: readonly string[] = [];
    const handler: AgentHandler = {
      run: async (c) => {
        toolsSeen = c.tools.available().map((d) => d.id);
        skillsSeen = c.skills.available().map((d) => d.id);
        return { ok: true, value: okResult() };
      },
    };
    registry.register({ definition: makeDefinition(), handler });
    const runtime = new DefaultAgentRuntime(registry);
    const { ctx } = makeContext();
    await runtime.execute(AGENT, ctx);
    expect(toolsSeen).toEqual(['tool.fs.read']);
    expect(skillsSeen).toEqual(['skill.read-symbol']);
  });

  it('rejects a result whose confidence is out of range', async () => {
    const registry = new MapAgentRegistry();
    registry.register({
      definition: makeDefinition(),
      handler: handlerReturning(okResult({ confidence: 1.5 })),
    });
    const runtime = new DefaultAgentRuntime(registry);
    const { ctx } = makeContext();
    const res = await runtime.execute(AGENT, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('agent.result.confidence_range');
  });

  it('rejects an issue whose provenance does not match the executing agent', async () => {
    const registry = new MapAgentRegistry();
    const badIssue = {
      id: 'issue.1' as IssueId,
      title: 't',
      description: 'd',
      severity: 'low' as const,
      confidence: 0.8,
      reason: 'r',
      location: { file: 'a.ts' },
      references: [],
      category: 'code' as const,
      producedBy: 'agent.someone-else' as AgentId,
      fingerprint: 'hash' as ContentHash,
    };
    registry.register({
      definition: makeDefinition(),
      handler: handlerReturning(okResult({ issues: [badIssue] })),
    });
    const runtime = new DefaultAgentRuntime(registry);
    const { ctx } = makeContext();
    const res = await runtime.execute(AGENT, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('agent.issue.provenance');
  });

  it('normalizes a thrown handler into a typed error', async () => {
    const registry = new MapAgentRegistry();
    registry.register({
      definition: makeDefinition(),
      handler: {
        run: async () => {
          throw new Error('boom');
        },
      },
    });
    const runtime = new DefaultAgentRuntime(registry);
    const { ctx } = makeContext();
    const res = await runtime.execute(AGENT, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('agent.handler_threw');
      expect(res.error.message).toBe('boom');
    }
  });

  it('returns the validated result on the happy path', async () => {
    const registry = new MapAgentRegistry();
    registry.register({ definition: makeDefinition(), handler: handlerReturning(okResult()) });
    const runtime = new DefaultAgentRuntime(registry);
    const { ctx } = makeContext();
    const res = await runtime.execute(AGENT, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.agentId).toBe(AGENT);
  });
});

describe('MapAgentRegistry', () => {
  it('lists definitions sorted by descending priority', () => {
    const registry = new MapAgentRegistry();
    registry.register({ definition: makeDefinition({ id: 'agent.a' as AgentId, priority: 10 }) });
    registry.register({ definition: makeDefinition({ id: 'agent.b' as AgentId, priority: 90 }) });
    const ids = registry.list().map((d) => d.id);
    expect(ids).toEqual(['agent.b', 'agent.a']);
  });

  it('last write wins for the same id (deliberate override)', () => {
    const registry = new MapAgentRegistry();
    registry.register({ definition: makeDefinition({ name: 'first' }) });
    registry.register({ definition: makeDefinition({ name: 'second' }) });
    expect(registry.get(AGENT)?.definition.name).toBe('second');
  });
});
