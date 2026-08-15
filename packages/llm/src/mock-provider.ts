/**
 * Offline mock LLM provider (ADR-0007).
 *
 * A deterministic, zero-cost `LLMProvider` used for local development, tests, and
 * demos where no API key is available. It parses the review prompt for a diff and
 * a `FOCUS:<category>` marker (set by each specialist agent) and returns
 * structured JSON findings via a small, transparent ruleset.
 *
 * This is NOT a model. It exists so the whole pipeline can run end-to-end without
 * spending tokens. Real providers (Claude/OpenAI/…) implement the same contract
 * and drop in without changing any caller.
 */

import type {
  AsyncResult,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ModelDescriptor,
  ModelId,
  ProviderId,
} from '@ai-review/core';

interface DetectedIssue {
  readonly title: string;
  readonly description: string;
  readonly severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  readonly confidence: number;
  readonly reason: string;
  readonly suggestion: string;
  readonly file: string;
  readonly line: number;
  readonly category: string;
}

/** A single pattern rule the mock applies to added (`+`) diff lines. */
interface PatternRule {
  readonly category: string;
  readonly test: RegExp;
  readonly title: string;
  readonly severity: DetectedIssue['severity'];
  readonly confidence: number;
  readonly reason: string;
  readonly suggestion: string;
}

const RULES: readonly PatternRule[] = [
  {
    category: 'security',
    test: /dangerouslySetInnerHTML/,
    title: 'Potential XSS via dangerouslySetInnerHTML',
    severity: 'high',
    confidence: 0.82,
    reason: 'Rendering raw HTML can inject script if the value is user-controlled.',
    suggestion: 'Sanitize the HTML (e.g., DOMPurify) or render as text.',
  },
  {
    category: 'security',
    test: /\b(eval|new Function)\s*\(/,
    title: 'Use of eval / dynamic code execution',
    severity: 'critical',
    confidence: 0.9,
    reason: 'eval executes arbitrary code and is a common RCE/XSS vector.',
    suggestion: 'Replace with an explicit, safe parser or lookup.',
  },
  {
    category: 'security',
    test: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{6,}['"]/i,
    title: 'Hardcoded secret',
    severity: 'high',
    confidence: 0.75,
    reason: 'Secrets committed to source control leak credentials.',
    suggestion: 'Move the value to an environment variable or secret store.',
  },
  {
    category: 'code',
    test: /console\.(log|debug|info)\s*\(/,
    title: 'Leftover console statement',
    severity: 'low',
    confidence: 0.7,
    reason: 'Debug logging should not ship to production.',
    suggestion: 'Remove the console call or use a proper logger.',
  },
  {
    category: 'code',
    test: /:\s*any\b|<any>/,
    title: 'Use of the any type',
    severity: 'medium',
    confidence: 0.68,
    reason: '`any` disables type checking and hides real bugs.',
    suggestion: 'Use a precise type or `unknown` with narrowing.',
  },
  {
    category: 'react',
    test: /\.map\s*\(\s*\(?[^)]*\)?\s*=>\s*<[A-Za-z]/,
    title: 'List render may be missing a stable key',
    severity: 'medium',
    confidence: 0.6,
    reason: 'Elements rendered from .map() need a stable `key` to avoid reconciliation bugs.',
    suggestion: 'Add a stable `key` prop derived from item identity (not the index).',
  },
  {
    category: 'react',
    test: /useEffect\s*\(\s*[^,]*\)\s*(?!,)/,
    title: 'useEffect without a dependency array',
    severity: 'medium',
    confidence: 0.55,
    reason: 'An effect with no dependency array runs on every render.',
    suggestion: 'Add an explicit dependency array.',
  },
  {
    category: 'performance',
    test: /JSON\.parse\s*\(\s*JSON\.stringify/,
    title: 'Deep clone via JSON round-trip',
    severity: 'low',
    confidence: 0.6,
    reason: 'JSON round-trip cloning is slow and drops non-JSON values.',
    suggestion: 'Use structuredClone() or a targeted copy.',
  },
];

const MODEL_ID = 'mock.deterministic' as ModelId;
const PROVIDER_ID = 'provider.mock' as ProviderId;

/** Parses `diff --git`-style headers to attribute added lines to a file + line no. */
function scanDiff(diff: string, focus: string): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  let currentFile = 'unknown';
  let newLineNo = 0;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      currentFile = raw
        .replace(/^\+\+\+\s+b\//, '')
        .replace(/^\+\+\+\s+/, '')
        .trim();
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLineNo = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      const content = raw.slice(1);
      for (const rule of RULES) {
        if (rule.category !== focus) continue;
        if (rule.test.test(content)) {
          issues.push({
            title: rule.title,
            description: `${rule.title} at ${currentFile}:${newLineNo}.`,
            severity: rule.severity,
            confidence: rule.confidence,
            reason: rule.reason,
            suggestion: rule.suggestion,
            file: currentFile,
            line: newLineNo,
            category: rule.category,
          });
        }
      }
      newLineNo++;
    } else if (!raw.startsWith('-')) {
      // Context line advances the new-file line counter.
      newLineNo++;
    }
  }
  return issues;
}

function extractFocus(request: LLMRequest): string {
  const sys = request.messages.find((m) => m.role === 'system')?.content ?? '';
  return /FOCUS:([a-z]+)/.exec(sys)?.[1] ?? 'code';
}

function extractDiff(request: LLMRequest): string {
  // The agent embeds the rendered context (the diff) in the user message.
  return request.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');
}

/** Rough token estimate (~4 chars/token) — enough for budgeting in the slice. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class MockLLMProvider implements LLMProvider {
  readonly id = PROVIDER_ID;

  models(): readonly ModelDescriptor[] {
    return [
      {
        id: MODEL_ID,
        provider: PROVIDER_ID,
        tier: 'local',
        capabilities: ['text', 'json_mode'],
        contextWindow: 128_000,
        inputCostPer1M: 0,
        outputCostPer1M: 0,
      },
    ];
  }

  async complete(request: LLMRequest): AsyncResult<LLMResponse> {
    const focus = extractFocus(request);
    const diff = extractDiff(request);
    const issues = scanDiff(diff, focus);
    const confidence = issues.length === 0 ? 0.9 : Math.min(...issues.map((i) => i.confidence));
    const summary =
      issues.length === 0
        ? `No ${focus} issues detected in the changed lines.`
        : `Found ${issues.length} ${focus} issue(s).`;

    const content = JSON.stringify({ issues, confidence, summary });
    const promptText = request.messages.map((m) => m.content).join('\n');

    return {
      ok: true,
      value: {
        model: MODEL_ID,
        content,
        usage: {
          promptTokens: estimateTokens(promptText),
          completionTokens: estimateTokens(content),
        },
        finishReason: 'stop',
      },
    };
  }
}
