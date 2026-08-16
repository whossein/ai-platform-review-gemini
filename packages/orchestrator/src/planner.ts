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
  // If there are no files (e.g., empty diff or parsing failed), we might want to default to running general reviewers just in case.
  const hasCodeFiles = ctx.exts.size === 0 || [...ctx.exts].some(ext => 
    ['.ts', '.tsx', '.js', '.jsx', '.cs', '.py', '.java', '.kt', '.swift', '.m', '.h', '.vue', '.html'].includes(ext)
  );

  switch (focus) {
    case 'react':
      return ['.tsx', '.jsx'].some((e) => ctx.exts.has(e)) || /\buse[A-Z]\w*\(|<[A-Z][A-Za-z0-9]*/.test(ctx.added);
    case 'dotnet':
    case 'dotnet, csharp':
    case 'csharp':
      return ['.cs', '.csproj'].some((e) => ctx.exts.has(e)) || /\busing\s+System\b|\bnamespace\b/.test(ctx.added);
    case 'python':
      return ['.py', '.ipynb'].some((e) => ctx.exts.has(e)) || (!['.kt', '.java', '.xml', '.swift', '.m', '.h', '.ts', '.tsx', '.js', '.jsx'].some((e) => ctx.exts.has(e)) && /\bimport\s+[a-zA-Z_]\w*\b|\bdef\s+[a-zA-Z_]\w*\s*\(/.test(ctx.added));
    case 'android':
      return ['.kt', '.java', '.xml'].some((e) => ctx.exts.has(e)) || /\bimport\s+android\b|\bimport\s+androidx\b/.test(ctx.added);
    case 'ios':
      return ['.swift', '.m', '.h'].some((e) => ctx.exts.has(e)) || /\bimport\s+UIKit\b|\bimport\s+SwiftUI\b|\bimport\s+Foundation\b/.test(ctx.added);
    case 'nextjs':
      // Very broad since it's React based, but look for next specific things or just run if TSX/JSX
      return ['.tsx', '.jsx'].some((e) => ctx.exts.has(e)) && (/\bnext\/|\bapp\/|\bpages\//.test(ctx.added) || ctx.files.some(f => f.includes('/app/') || f.includes('/pages/')));
    case 'angular':
      return ['.ts', '.html'].some((e) => ctx.exts.has(e)) && /\b@Component\b|\b@Injectable\b|\b@NgModule\b/.test(ctx.added);
    case 'vuejs':
      return ['.vue'].some((e) => ctx.exts.has(e)) || /\bdefineComponent\b|\bref\(|\breactive\(/.test(ctx.added);
    case 'typescript':
      return ['.ts', '.tsx'].some((e) => ctx.exts.has(e));
    case 'react-native':
      return ['.tsx', '.jsx', '.js', '.ts'].some((e) => ctx.exts.has(e)) && /\breact-native\b/.test(ctx.added);
    
    // General reviewers
    case 'security':
    case 'performance':
    case 'code':
      return hasCodeFiles;

    case 'governance':
    case 'governance, contributing, docs':
    case 'contributing':
    case 'docs':
      // Runs whenever changes are introduced to audit release notes, docs, branch names, commit messages & contributing rules
      return true;
      
    default:
      // If we don't know the focus (e.g. custom user skills), default to running it 
      // or we could check if they have targets configured, but the planner currently just sees 'focus' string.
      // We will default to true so we don't accidentally skip a custom skill.
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
