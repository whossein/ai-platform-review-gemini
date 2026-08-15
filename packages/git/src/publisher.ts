/**
 * Review publisher (Phase 9).
 *
 * Turns adjudicated review issues into inline GitLab discussions — the final
 * "GitLab Publisher" stage of the review flow. It only publishes ACCEPTED
 * issues (the Judge already filtered), posts one inline discussion per issue at
 * its file/line, and posts a single summary discussion. Optionally approves the
 * MR when no blocking (high/critical) issues remain.
 *
 * It depends only on the `GitProvider` contract, so it works with any provider
 * (GitLab today, GitHub/Azure/Bitbucket later) without change.
 */

import type {
  AdjudicatedIssue,
  AsyncResult,
  ChangeRequestRef,
  GitProvider,
  Severity,
} from '@ai-review/core';

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: '⚪',
};

const BLOCKING: ReadonlySet<Severity> = new Set<Severity>(['high', 'critical']);

// Invisible marker embedded in every issue comment we post. Lets a later run
// recognize "we already commented here" without depending on exact wording
// (the LLM's phrasing isn't stable across reruns, but file+line mostly is).
const BOT_MARKER = '<!-- ai-review:issue-comment -->';

function locationKey(location: { readonly file: string; readonly line?: number }): string {
  return `${location.file}|${location.line ?? ''}`;
}

export interface PublishOptions {
  /** Approve the MR when there are no blocking issues. Default: false. */
  readonly approveWhenClean?: boolean;
  /** Skip inline comments and only post the summary. Default: false. */
  readonly summaryOnly?: boolean;
}

export interface PublishResult {
  readonly published: number;
  readonly approved: boolean;
  readonly blockingCount: number;
  /** Issues whose discussion failed to post even after the plain-comment fallback. */
  readonly failed: readonly { readonly issueId: string; readonly message: string }[];
  /** Issues skipped because a bot comment already exists at that file/line. */
  readonly skipped: number;
}

/** Renders a single issue as a GitLab-flavored Markdown comment body. */
export function renderIssueComment(issue: AdjudicatedIssue): string {
  const lines = [
    `${SEVERITY_EMOJI[issue.severity]} **${issue.severity.toUpperCase()}: ${issue.title}**`,
    '',
    issue.description,
    '',
    `_Why:_ ${issue.reason}`,
  ];
  if (issue.suggestion) lines.push('', `_Suggestion:_ ${issue.suggestion.description}`);
  lines.push(
    '',
    `<sub>${issue.category} · confidence ${(issue.confidence * 100).toFixed(0)}%</sub>`,
    BOT_MARKER,
  );
  return lines.join('\n');
}

/** Renders the roll-up summary comment for the whole review. */
export function renderSummaryComment(issues: readonly AdjudicatedIssue[]): string {
  if (issues.length === 0) {
    return '## 🤖 AI Code Review\n\nNo issues met the publish threshold. ';
  }
  const byCategory = new Map<string, number>();
  for (const i of issues) byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + 1);
  const blocking = issues.filter((i) => BLOCKING.has(i.severity)).length;
  const breakdown = [...byCategory.entries()].map(([c, n]) => `- ${c}: ${n}`).join('\n');
  return [
    '## 🤖 AI Code Review',
    '',
    `Found **${issues.length}** issue(s)${blocking > 0 ? ` (**${blocking}** blocking)` : ''}.`,
    '',
    breakdown,
  ].join('\n');
}

export class ReviewPublisher {
  constructor(private readonly provider: GitProvider) {}

  async publish(
    ref: ChangeRequestRef,
    issues: readonly AdjudicatedIssue[],
    opts: PublishOptions = {},
  ): AsyncResult<PublishResult> {
    const accepted = issues.filter((i) => i.accepted);
    let published = 0;
    let skipped = 0;
    const failed: { issueId: string; message: string }[] = [];

    // Dedup: don't re-post a comment where we already left one. Best-effort —
    // if listing existing discussions fails (permissions, transient error), we
    // fall back to publishing everything rather than losing the review.
    const existingRes = await this.provider.listDiscussions(ref);
    const alreadyCommented = new Set<string>();
    if (existingRes.ok) {
      for (const d of existingRes.value) {
        if (d.location && d.body.includes(BOT_MARKER)) {
          alreadyCommented.add(locationKey(d.location));
        }
      }
    }

    if (!opts.summaryOnly) {
      for (const issue of accepted) {
        const location = issue.location.file
          ? {
              file: issue.location.file,
              ...(issue.location.line !== undefined ? { line: issue.location.line } : {}),
            }
          : undefined;

        if (location && alreadyCommented.has(locationKey(location))) {
          skipped++;
          continue;
        }

        const res = await this.provider.createDiscussion(ref, renderIssueComment(issue), location);
        // One bad finding (e.g. a line position GitLab rejects) must not sink
        // every other, already-valid discussion in the batch — keep going and
        // report the failure instead of aborting the whole publish.
        if (!res.ok) {
          failed.push({ issueId: issue.id, message: res.error.message });
          continue;
        }
        published++;
        // Guard against the same location appearing twice within THIS run's
        // own accepted list (e.g. the Critic missed a dedup) posting twice.
        if (location) alreadyCommented.add(locationKey(location));
      }
    }

    // Always post a summary discussion.
    const summaryRes = await this.provider.createDiscussion(ref, renderSummaryComment(accepted));
    if (!summaryRes.ok) return summaryRes;

    const blockingCount = accepted.filter((i) => BLOCKING.has(i.severity)).length;
    let approved = false;
    if (opts.approveWhenClean && blockingCount === 0) {
      const approveRes = await this.provider.approve(ref);
      if (!approveRes.ok) return approveRes;
      approved = true;
    }

    return { ok: true, value: { published, approved, blockingCount, failed, skipped } };
  }
}
