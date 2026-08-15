/**
 * Deterministic Rule Engine contracts (ADR-0006).
 *
 * Runs before any AI: ESLint, TypeScript, secret detection, formatting,
 * dependency/naming/architecture rules. Findings are free (no tokens), seed the
 * agents, and suppress redundant AI work.
 */

import type { AsyncResult } from './result.js';
import type { CodeLocation, Issue } from './issue.js';

export type RuleKind =
  | 'eslint'
  | 'typescript'
  | 'secret_detection'
  | 'formatting'
  | 'dependency'
  | 'naming'
  | 'architecture'
  | (string & {});

/** A deterministic finding — precise, cheap, and trustworthy. */
export interface RuleFinding {
  readonly ruleKind: RuleKind;
  readonly ruleId: string;
  readonly message: string;
  readonly location: CodeLocation;
  readonly severity: Issue['severity'];
}

export interface RuleContext {
  readonly repositoryId: string;
  /** Restrict checks to changed files when reviewing a diff. */
  readonly changedPaths?: readonly string[];
}

/** A single deterministic check. Implementations live in `config`/plugins. */
export interface Rule {
  readonly kind: RuleKind;
  readonly id: string;
  run(ctx: RuleContext): AsyncResult<readonly RuleFinding[]>;
}

export interface RuleRegistry {
  register(rule: Rule): void;
  list(): readonly Rule[];
}

/** Aggregated deterministic result folded into `SharedContext`. */
export interface RuleEngineResult {
  readonly findings: readonly RuleFinding[];
  /** Concerns fully covered deterministically, so agents can skip them. */
  readonly coveredConcerns: readonly RuleKind[];
}

/** Runs all applicable rules before AI. Implementation lives in `config`. */
export interface RuleEngine {
  run(ctx: RuleContext): AsyncResult<RuleEngineResult>;
}
