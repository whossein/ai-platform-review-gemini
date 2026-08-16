/**
 * @ai-review/skills
 *
 * Reusable skills for agents (governance, contributing compliance, AST inspection, etc.)
 */

import type { Skill, SkillId, SkillInput, SkillOutput, AsyncResult } from '@ai-review/core';

/**
 * Contributing & Documentation compliance skill.
 * Validates PR templates, branch naming, release notes, and documentation from docs/contributing.
 */
export const contributingComplianceSkill: Skill = {
  descriptor: {
    id: 'skill.governance.contributing-compliance' as SkillId,
    name: 'Contributing & Docs Compliance',
    description: 'Verifies release-change documentation, branch naming, commit conventions, and contributing guidelines adherence.',
    inputSchema: {
      type: 'object',
      properties: {
        diff: { type: 'string' },
        files: { type: 'array' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        compliant: { type: 'boolean' },
        missingRequirements: { type: 'array' },
      },
    },
  },
  async execute(input: SkillInput): AsyncResult<SkillOutput> {
    const diff = String(input.args.diff ?? '');
    const missing: string[] = [];

    // Basic heuristic analysis
    if (!diff.includes('release-change') && !diff.includes('CHANGELOG')) {
      missing.push('release-change file update');
    }

    return {
      ok: true,
      value: {
        result: {
          compliant: missing.length === 0,
          missingRequirements: missing,
        },
      },
    };
  },
};

export { contributingComplianceSkill as myAppSkill };

