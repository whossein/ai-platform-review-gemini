/**
 * Deterministic rules (ADR-0006) — the platform's #1 cost principle in action.
 *
 * These checks run BEFORE any LLM call. They are free (no tokens), precise, and
 * trustworthy. Their findings seed the agents and let the Planner suppress
 * redundant AI work ("secret detection already covers X"). Each rule inspects
 * file texts and returns structured `RuleFinding`s.
 *
 * The set here is intentionally deterministic and regex/heuristic based (no
 * external processes). Real ESLint/tsc integrations implement the same `Rule`
 * contract and register alongside these without changing the engine.
 */

import type { Rule, RuleContext, RuleFinding } from '@ai-review/core';

/** Extended context carrying the file texts to scan (offline, no FS access). */
export interface FileRuleContext extends RuleContext {
  readonly files: readonly { readonly path: string; readonly text: string }[];
}

function isFileCtx(ctx: RuleContext): ctx is FileRuleContext {
  return Array.isArray((ctx as FileRuleContext).files);
}

/** Runs a per-line matcher across all files, producing findings. */
function scanLines(
  ctx: RuleContext,
  match: (line: string) => string | undefined,
  make: (path: string, line: number, why: string) => RuleFinding,
): RuleFinding[] {
  if (!isFileCtx(ctx)) return [];
  const findings: RuleFinding[] = [];
  for (const file of ctx.files) {
    const lines = file.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const why = match(lines[i]!);
      if (why !== undefined) findings.push(make(file.path, i + 1, why));
    }
  }
  return findings;
}

/** Detects hardcoded secrets / API keys / tokens in added code. */
export const secretDetectionRule: Rule = {
  kind: 'secret_detection',
  id: 'secret.hardcoded',
  async run(ctx) {
    const patterns: readonly RegExp[] = [
      /sk-[a-zA-Z0-9]{8,}/, // OpenAI-style secret keys
      /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]{6,}['"]/i,
      /AKIA[0-9A-Z]{16}/, // AWS access key id
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) => (patterns.some((p) => p.test(line)) ? 'matches a secret pattern' : undefined),
        (file, line) => ({
          ruleKind: 'secret_detection',
          ruleId: 'secret.hardcoded',
          message: 'Possible hardcoded secret; move it to an environment variable or secret store.',
          location: { file, line },
          severity: 'high',
        }),
      ),
    };
  },
};

/** Flags leftover `console.*` debug statements. */
export const noConsoleRule: Rule = {
  kind: 'eslint',
  id: 'no-console',
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) =>
          /\bconsole\.(log|debug|info|warn|error)\s*\(/.test(line) ? 'console call' : undefined,
        (file, line) => ({
          ruleKind: 'eslint',
          ruleId: 'no-console',
          message: 'Leftover console statement; remove it or use a proper logger.',
          location: { file, line },
          severity: 'low',
        }),
      ),
    };
  },
};

/** Flags debugger statements. */
export const noDebuggerRule: Rule = {
  kind: 'eslint',
  id: 'no-debugger',
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) => (/\bdebugger\s*;?/.test(line) ? 'debugger statement' : undefined),
        (file, line) => ({
          ruleKind: 'eslint',
          ruleId: 'no-debugger',
          message: 'Unexpected `debugger` statement found.',
          location: { file, line },
          severity: 'high',
        }),
      ),
    };
  },
};

/** Flags eval() usage. */
export const noEvalRule: Rule = {
  kind: 'eslint',
  id: 'no-eval',
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) => (/\beval\s*\(/.test(line) ? 'eval function' : undefined),
        (file, line) => ({
          ruleKind: 'eslint',
          ruleId: 'no-eval',
          message: 'Avoid using `eval()`. It is a major security risk and hurts performance.',
          location: { file, line },
          severity: 'critical',
        }),
      ),
    };
  },
};

/** Flags skipped or exclusive tests (.only / .skip). */
export const noExclusiveTestsRule: Rule = {
  kind: 'eslint',
  id: 'no-exclusive-tests',
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) => (/\b(describe|it|test)\.(only|skip)\b/.test(line) ? 'exclusive test' : undefined),
        (file, line) => ({
          ruleKind: 'eslint',
          ruleId: 'no-exclusive-tests',
          message: 'Exclusive or skipped test found (e.g. `.only` or `.skip`). Ensure this is intentional before merging.',
          location: { file, line },
          severity: 'medium',
        }),
      ),
    };
  },
};

/** Flags use of the `any` type in TypeScript. */
export const noExplicitAnyRule: Rule = {
  kind: 'typescript',
  id: 'no-explicit-any',
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) => (/(:\s*any\b|<any>|as\s+any\b|Array<any>)/.test(line) ? 'any type' : undefined),
        (file, line) => ({
          ruleKind: 'typescript',
          ruleId: 'no-explicit-any',
          message: 'Use of `any` disables type checking; use a precise type or `unknown`.',
          location: { file, line },
          severity: 'medium',
        }),
      ),
    };
  },
};

/** Flags `TODO`/`FIXME` markers so they are tracked, not silently shipped. */
export const noTodoRule: Rule = {
  kind: 'naming',
  id: 'no-todo-comment',
  async run(ctx) {
    return {
      ok: true,
      value: scanLines(
        ctx,
        (line) => (/\b(TODO|FIXME|XXX)\b/.test(line) ? 'tracking marker' : undefined),
        (file, line) => ({
          ruleKind: 'naming',
          ruleId: 'no-todo-comment',
          message: 'Unresolved TODO/FIXME marker; track it in an issue before merging.',
          location: { file, line },
          severity: 'info',
        }),
      ),
    };
  },
};

/** The built-in deterministic rule set. */
export const DEFAULT_RULES: readonly Rule[] = [
  secretDetectionRule,
  noConsoleRule,
  noDebuggerRule,
  noEvalRule,
  noExclusiveTestsRule,
  noExplicitAnyRule,
  noTodoRule,
];
