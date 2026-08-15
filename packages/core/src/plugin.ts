/**
 * Plugin contracts.
 *
 * Everything extensible — agents, tools, skills, LLM providers, git providers,
 * input resolvers, rules, reporters, workflows, prompts — is contributed via
 * plugins registered at boot. Plugins depend only on `core` contracts
 * (ADR-0002), never on internal implementations.
 */

import type { AgentRegistry } from './agent.js';
import type { ToolRegistry } from './tool.js';
import type { SkillRegistry } from './skill.js';
import type { GitProviderRegistry } from './git.js';
import type { InputResolverRegistry } from './repository.js';
import type { RuleRegistry } from './rules.js';
import type { ReporterRegistry } from './reporting.js';
import type { WorkflowRegistry } from './workflow.js';
import type { PromptRegistry } from './prompt.js';

/**
 * The set of registries a plugin may contribute to during registration.
 * Passing registries (not implementations) keeps plugins decoupled and enforces
 * the inward dependency rule.
 */
export interface PluginRegistrationContext {
  readonly agents: AgentRegistry;
  readonly tools: ToolRegistry;
  readonly skills: SkillRegistry;
  readonly gitProviders: GitProviderRegistry;
  readonly inputResolvers: InputResolverRegistry;
  readonly rules: RuleRegistry;
  readonly reporters: ReporterRegistry;
  readonly workflows: WorkflowRegistry;
  readonly prompts: PromptRegistry;
}

/** A unit of extension. Registered once at boot. */
export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** Semver range of the core contract this plugin was built against. */
  readonly coreCompat: string;
  /** Contribute agents/tools/skills/etc. into the provided registries. */
  register(ctx: PluginRegistrationContext): void | Promise<void>;
}

/** Loads and registers plugins at boot. Implementation lives at composition root. */
export interface PluginHost {
  load(plugin: Plugin): Promise<void>;
  loaded(): readonly string[];
}
