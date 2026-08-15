/**
 * @ai-review/config
 *
 * Configuration + the deterministic Rule Engine (ADR-0006). Rules run before
 * any AI: free, precise, and used to suppress redundant LLM work.
 *  - `DefaultRuleEngine` + `MapRuleRegistry`
 *  - built-in rules: secret detection, no-console, no-explicit-any, no-todo
 *  - `ruleFindingToIssue` — lifts a deterministic finding into the canonical
 *    `Issue` shape (confidence 1.0) so it flows through the same report/judge path.
 */

import type { AgentId, Issue, RuleFinding } from '@ai-review/core';
import { fingerprintIssue, issueId } from '@ai-review/shared';

export { DefaultRuleEngine, MapRuleRegistry } from './engine.js';
export {
  DEFAULT_RULES,
  secretDetectionRule,
  noConsoleRule,
  noExplicitAnyRule,
  noTodoRule,
} from './rules.js';
export type { FileRuleContext } from './rules.js';

/** The synthetic agent id attributed to deterministic (non-AI) findings. */
export const RULE_ENGINE_AGENT = 'agent.rule-engine' as AgentId;

/**
 * Lifts a deterministic `RuleFinding` into the canonical `Issue` shape. Rule
 * findings get confidence 1.0 — they are deterministic and trustworthy.
 */
export function ruleFindingToIssue(finding: RuleFinding): Issue {
  const fingerprint = fingerprintIssue({
    category: finding.ruleKind,
    ruleId: finding.ruleId,
    file: finding.location.file,
    ...(finding.location.symbol ? { symbol: finding.location.symbol } : {}),
  });
  return {
    id: issueId(fingerprint),
    title: finding.ruleId,
    description: finding.message,
    severity: finding.severity,
    confidence: 1,
    reason: `Deterministic rule "${finding.ruleId}" matched (no LLM tokens spent).`,
    location: finding.location,
    references: [],
    category: finding.ruleKind === 'secret_detection' ? 'security' : 'code',
    producedBy: RULE_ENGINE_AGENT,
    fingerprint,
  };
}
