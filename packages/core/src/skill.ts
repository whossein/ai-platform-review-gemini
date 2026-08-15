/**
 * Skill contracts.
 *
 * Skills are reusable, composable capabilities built on top of tools + context
 * (e.g., Read File, Read Diff, Read Symbol, Find References, Search Project,
 * Analyze Imports/Dependencies, Generate Markdown/Git Comments/Summary).
 * Agents declare `allowedSkills`; the runtime gates access.
 */

import type { SkillId } from './ids.js';
import type { AsyncResult } from './result.js';

export interface SkillDescriptor {
  readonly id: SkillId;
  readonly name: string;
  readonly description: string;
  /** Input/output JSON schemas for validation and tooling. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

export interface SkillInput {
  readonly skillId: SkillId;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface SkillOutput {
  readonly result: Readonly<Record<string, unknown>>;
}

/**
 * A reusable capability. Implementations live in `skills` and may use tools and
 * context internally; they never bypass capability gating.
 */
export interface Skill {
  readonly descriptor: SkillDescriptor;
  execute(input: SkillInput): AsyncResult<SkillOutput>;
}

export interface SkillRegistry {
  register(skill: Skill): void;
  get(id: SkillId): Skill | undefined;
  list(): readonly SkillDescriptor[];
}

/** Capability-gated skill access handed to an agent. */
export interface SkillAccessor {
  execute(input: SkillInput): AsyncResult<SkillOutput>;
  available(): readonly SkillDescriptor[];
}
