/**
 * Planner — Smart Routing (the review flow's first stage).
 *
 * The single biggest token lever after the deterministic Rule Engine: only run
 * the specialists that the change can actually benefit from. The Planner inspects
 * the changed files (paths + added lines) and selects a subset of specialists,
 * so a pure-CSS change never pays for a security LLM call, and a change with no
 * React files never pays for the React reviewer.
 *
 * It is deterministic and free (no LLM), fully unit-tested, and returns a plan
 * the orchestrator executes. A future LLM-backed Planner can implement the same
 * `plan()` contract without changing callers (ADR-0003/0007).
 */

import type { SpecialistSpec } from './agents.js';

export interface PlanInput {
  /** The unified diff under review. */
  readonly diff: string;
  /** All available specialists (already registered). */
  readonly specialists: readonly SpecialistSpec[];
  /** Findings the deterministic Rule Engine already covered, by category. */
  readonly coveredCategories?: readonly string[];
}

export interface ReviewPlan {
  /** Specialists selected to run, highest priority first. */
  readonly selected: readonly SpecialistSpec[];
  /** Specialists intentionally skipped, with a human-readable reason. */
  readonly skipped: readonly { readonly spec: SpecialistSpec; readonly reason: string }[];
  /** The distinct file extensions detected in the change. */
  readonly extensions: readonly string[];
}

/** Extracts changed file paths from `diff --git a/… b/…` / `+++ b/…` headers. */
export function changedFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split('\n')) {
    const git = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (git?.[1]) files.add(git[1]);
    const plus = /^\+\+\+ b\/(.+)$/.exec(line);
    if (plus?.[1] && plus[1] !== '/dev/null') files.add(plus[1]);
  }
  return [...files];
}

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(i).toLowerCase();
}

/** Added (`+`) lines only — what the change actually introduces. */
function addedText(diff: string): string {
  return diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .join('\n');
}

/**
 * Decides whether a specialist is relevant to this change. Kept intentionally
 * simple and conservative: when unsure, include the specialist (a missed review
 * is worse than a few extra tokens). Heuristics are per-focus.
 */
function isRelevant(
  focus: string,
  ctx: { readonly files: readonly string[]; readonly added: string; readonly exts: Set<string> },
): boolean {
  const hasTs = ['.ts', '.tsx'].some((e) => ctx.exts.has(e));
  const hasJsx = ['.tsx', '.jsx'].some((e) => ctx.exts.has(e));
  switch (focus) {
    case 'react':
      // React reviewer only makes sense with JSX/TSX or explicit hook/component usage.
      return hasJsx || /\buse[A-Z]\w*\(|<[A-Z][A-Za-z0-9]*/.test(ctx.added);
    case 'security':
      // Security is code-shaped; skip only for pure non-code assets.
      return hasTs || ctx.exts.has('.js') || ctx.exts.has('.jsx') || ctx.files.length === 0;
    case 'performance':
      return hasTs || ctx.exts.has('.js') || ctx.exts.has('.jsx');
    case 'code':
      // General code quality runs whenever there is any code at all.
      return hasTs || ctx.exts.has('.js') || ctx.exts.has('.jsx');
    default:
      return true;
  }
}

export function plan(input: PlanInput): ReviewPlan {
  const files = changedFiles(input.diff);
  const exts = new Set(files.map(extOf).filter(Boolean));
  const added = addedText(input.diff);
  const covered = new Set(input.coveredCategories ?? []);

  const selected: SpecialistSpec[] = [];
  const skipped: { spec: SpecialistSpec; reason: string }[] = [];

  for (const spec of input.specialists) {
    if (!isRelevant(spec.focus, { files, added, exts })) {
      skipped.push({ spec, reason: `no ${spec.focus}-relevant files in the change` });
      continue;
    }
    if (covered.has(spec.focus)) {
      skipped.push({ spec, reason: `${spec.focus} already covered by deterministic rules` });
      continue;
    }
    selected.push(spec);
  }

  // Highest-priority specialists first (security > react > performance > code).
  selected.sort((a, b) => b.priority - a.priority);

  return {
    selected,
    skipped,
    extensions: [...exts],
  };
}
