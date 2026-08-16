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

/**
 * Ensures modifications to functional source code include a corresponding update to `release-change` (or CHANGELOG.md)
 * when required by project guidelines or when such files exist in the repository.
 */
export const requireReleaseChangeRule: Rule = {
  kind: 'governance',
  id: 'governance.require-release-change',
  async run(ctx) {
    if (!isFileCtx(ctx)) return { ok: true, value: [] };
    const findings: RuleFinding[] = [];
    const files = ctx.files;
    
    // Check if the project actually uses or documents release-change / CHANGELOG / release notes
    const projectRequiresReleaseChange = files.some((f) => {
      const p = f.path.toLowerCase();
      return (
        p.includes('release-change') ||
        p.includes('changelog') ||
        p.includes('release-notes') ||
        (p.startsWith('docs/') && f.text.toLowerCase().includes('release-change')) ||
        (p.endsWith('contributing.md') && f.text.toLowerCase().includes('release-change'))
      );
    });

    if (!projectRequiresReleaseChange) {
      // If the project doesn't have or mention release-change, don't generate false positives
      return { ok: true, value: [] };
    }

    // Check if source code / functional features are modified
    const hasSourceChanges = files.some((f) => {
      const p = f.path.toLowerCase();
      return (
        p.startsWith('src/') ||
        p.startsWith('apps/') ||
        p.startsWith('packages/') ||
        p.startsWith('lib/') ||
        p.startsWith('app/') ||
        /\.(ts|tsx|js|jsx|cs|py|java|kt|swift|vue|go|rs|cpp|c|h)$/.test(p)
      );
    });

    const hasReleaseChangeInDiff = files.some((f) => {
      const p = f.path.toLowerCase();
      return (
        p.includes('release-change') ||
        p.endsWith('release-change.md') ||
        p.endsWith('release-notes.md') ||
        p.endsWith('changelog.md')
      );
    });

    if (hasSourceChanges && !hasReleaseChangeInDiff && files.length > 0) {
      findings.push({
        ruleKind: 'governance',
        ruleId: 'governance.require-release-change',
        message: 'فایل release-change (یا CHANGELOG.md) در این تغییرات ویرایش نشده است. طبق راهنمای مستندسازی این پروژه، هرگونه تغییر در سورس‌کد باید در گزارش تغییرات ثبت شود.',
        location: { file: 'release-change', line: 1 },
        severity: 'high',
      });
    }

    return { ok: true, value: findings };
  },
};

/**
 * Checks for project lint conventions and common static analysis errors (ESLint / Biome / Type standards).
 */
export const lintComplianceRule: Rule = {
  kind: 'eslint',
  id: 'lint.code-conventions',
  async run(ctx) {
    if (!isFileCtx(ctx)) return { ok: true, value: [] };
    const findings: RuleFinding[] = [];

    for (const file of ctx.files) {
      const lines = file.text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Check for common forbidden patterns: alert(), prompt(), confirm() in client/server code
        if (/\b(window\.)?(alert|confirm|prompt)\s*\(/.test(line)) {
          findings.push({
            ruleKind: 'eslint',
            ruleId: 'no-alert',
            message: 'استفاده از توابع مسدودکننده (alert/confirm/prompt) طبق استانداردهای کدنویسی مجاز نیست.',
            location: { file: file.path, line: i + 1 },
            severity: 'medium',
          });
        }
      }
    }

    return { ok: true, value: findings };
  },
};

/**
 * Validates commit message conventions (Conventional Commits: feat, fix, docs, refactor, chore, etc.)
 */
export const commitConventionRule: Rule = {
  kind: 'governance',
  id: 'governance.commit-convention',
  async run(ctx) {
    if (!isFileCtx(ctx)) return { ok: true, value: [] };
    const findings: RuleFinding[] = [];
    const conventionalCommitRegex = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-zA-Z0-9_\-./]+\))?!?: .+/i;
    const invalidCommitKeywords = /\b(update code|fix bug|changes|wip|temp|test commit|fixed|bugfix|updated)\b/i;

    for (const file of ctx.files) {
      const lines = file.text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        const isCommitLine = /^(commit\s+[0-9a-f]{7,40}|commit\s*:\s*|\[PATCH\]|message\s*:\s*)/i.test(line);
        if (isCommitLine) {
          const rawMessage = line.replace(/^(commit\s+[0-9a-f]{7,40}:?\s*|commit\s*:\s*|\[PATCH\]\s*|message\s*:\s*)/i, '').trim();
          if (rawMessage.length > 0) {
            if (invalidCommitKeywords.test(rawMessage) || !conventionalCommitRegex.test(rawMessage)) {
              findings.push({
                ruleKind: 'governance',
                ruleId: 'governance.commit-convention',
                message: `پیام کامیت "${rawMessage.slice(0, 50)}" با استاندارد Conventional Commits (مانند feat: یا fix:) منطبق نیست.`,
                location: { file: file.path, line: i + 1 },
                severity: 'medium',
              });
            }
          }
        }
      }
    }

    return { ok: true, value: findings };
  },
};

/**
 * Validates Git Branch naming conventions (feat/..., fix/..., chore/..., docs/..., etc.)
 */
export const branchNamingRule: Rule = {
  kind: 'governance',
  id: 'governance.branch-naming',
  async run(ctx) {
    if (!isFileCtx(ctx)) return { ok: true, value: [] };
    const findings: RuleFinding[] = [];
    const validBranchPattern = /^(feature|feat|fix|hotfix|bugfix|chore|docs|refactor|release|test)\/[a-zA-Z0-9._-]+$/i;

    for (const file of ctx.files) {
      const lines = file.text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        const branchMatch = /(?:source\s*branch|branch|refs\/heads\/|git\s+checkout\s+-b)\s*[:=]?\s*([a-zA-Z0-9_\-./]+)/i.exec(line);
        if (branchMatch && branchMatch[1]) {
          const branchName = branchMatch[1];
          if (!['main', 'master', 'develop', 'dev', 'staging', 'production'].includes(branchName) && !validBranchPattern.test(branchName)) {
            findings.push({
              ruleKind: 'governance',
              ruleId: 'governance.branch-naming',
              message: `نام برنچ "${branchName}" با الگوی استاندارد (مانند feat/name یا fix/issue-123) مطابقت ندارد.`,
              location: { file: file.path, line: i + 1 },
              severity: 'medium',
            });
          }
        }
      }
    }

    return { ok: true, value: findings };
  },
};

/**
 * Validates PR Template completeness (prevent leaving raw placeholders or empty templates)
 */
export const prTemplateComplianceRule: Rule = {
  kind: 'governance',
  id: 'governance.pr-template',
  async run(ctx) {
    if (!isFileCtx(ctx)) return { ok: true, value: [] };
    const findings: RuleFinding[] = [];
    const placeholderPatterns = [
      /<!--\s*describe\s+your\s+changes\s*-->/i,
      /<!--\s*issue\s+number\s*-->/i,
      /<!--\s*TODO\s*-->/i,
      /\[\s*\]\s*TODO/i,
      /TODO:\s*fill\s+this\s+out/i,
    ];

    for (const file of ctx.files) {
      const p = file.path.toLowerCase();
      if (p.includes('pull_request_template') || p.includes('pr_template') || p.includes('pr-description')) {
        const lines = file.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          for (const pattern of placeholderPatterns) {
            if (pattern.test(line)) {
              findings.push({
                ruleKind: 'governance',
                ruleId: 'governance.pr-template',
                message: 'پلیسهولد یا بخش ناقص پر نشده در قالب Pull Request یافت شد.',
                location: { file: file.path, line: i + 1 },
                severity: 'low',
              });
              break;
            }
          }
        }
      }
    }

    return { ok: true, value: findings };
  },
};

/** The built-in deterministic rule set (static checks that are universal and zero-false-positive). */
export const DEFAULT_RULES: readonly Rule[] = [
  secretDetectionRule,
  noConsoleRule,
  noDebuggerRule,
  noEvalRule,
  noExclusiveTestsRule,
  noExplicitAnyRule,
  noTodoRule,
  lintComplianceRule,
  requireReleaseChangeRule,
];
