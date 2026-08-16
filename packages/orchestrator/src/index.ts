/**
 * @ai-review/orchestrator
 *
 * The review composition root, extracted so every surface — CLI, HTTP API, Web,
 * and Desktop — runs the *same* pipeline instead of each re-implementing it:
 *
 *   Rule Engine → Planner (smart routing) → specialist agents (parallel) →
 *   Critic (consolidation) → Judge → Markdown/JSON report.
 *
 * Apps depend on this package; this package depends only on inward packages
 * (ADR-0002), so there is no app→app coupling.
 */

export { runReview, type RunOptions, type ReviewResult } from './orchestrator.js';
export {
  SPECIALISTS,
  makeSpecialistDefinition,
  makeSpecialistHandler,
  type SpecialistSpec,
} from './agents.js';
export { plan, changedFiles, type PlanInput, type ReviewPlan } from './planner.js';
export { critique, type CritiquedIssue } from './critic.js';
export { DefaultRuleEngine, MapRuleRegistry, DEFAULT_RULES, ruleFindingToIssue } from '@ai-review/config';
export { resolveProviderPreset, PROVIDER_CATALOG } from '@ai-review/llm';
