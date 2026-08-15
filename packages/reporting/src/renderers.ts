/**
 * Report renderers.
 *
 * Pluggable `Reporter` implementations that turn adjudicated findings into
 * concrete artifacts. New formats register without core changes (ADR-0002).
 * Markdown and JSON are provided as the baseline; GitLab discussions and HTML
 * follow the same contract.
 */

import type {
  AdjudicatedIssue,
  AsyncResult,
  Report,
  Reporter,
  ReporterRegistry,
  ReportFormat,
  ReportInput,
} from '@ai-review/core';

/** Map-backed reporter registry (last write wins per format). */
export class MapReporterRegistry implements ReporterRegistry {
  private readonly reporters = new Map<ReportFormat, Reporter>();

  register(reporter: Reporter): void {
    this.reporters.set(reporter.format, reporter);
  }

  get(format: ReportFormat): Reporter | undefined {
    return this.reporters.get(format);
  }

  list(): readonly ReportFormat[] {
    return [...this.reporters.keys()].sort();
  }
}

const SEVERITY_ORDER: Record<AdjudicatedIssue['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function sortIssues(issues: readonly AdjudicatedIssue[]): AdjudicatedIssue[] {
  // Highest rank first; ties broken by severity then file/line for stability.
  return [...issues].sort(
    (a, b) =>
      b.rankScore - a.rankScore ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.location.file < b.location.file ? -1 : 1) ||
      (a.location.line ?? 0) - (b.location.line ?? 0),
  );
}

/** Renders findings as a human-readable Markdown report. */
export class MarkdownReporter implements Reporter {
  readonly format = 'markdown' as const;

  async render(input: ReportInput): AsyncResult<Report> {
    const accepted = input.issues.filter((i) => i.accepted);
    const lines: string[] = [];
    lines.push('# AI Code Review');
    lines.push('');
    lines.push(input.summary);
    lines.push('');
    lines.push(
      `**${accepted.length} issue(s)** · ` +
        `${input.metrics.totalPromptTokens + input.metrics.totalCompletionTokens} tokens · ` +
        `$${input.metrics.totalCostUsd.toFixed(4)} · ` +
        `${input.metrics.totalExecutionMs}ms`,
    );
    lines.push('');

    if (accepted.length === 0) {
      lines.push('_No issues met the publish threshold._');
    } else {
      for (const issue of sortIssues(accepted)) {
        const loc = `${issue.location.file}:${issue.location.line ?? '?'}`;
        lines.push(`## [${issue.severity.toUpperCase()}] ${issue.title}`);
        lines.push('');
        lines.push(`- **Where:** \`${loc}\``);
        lines.push(`- **Category:** ${issue.category}`);
        lines.push(`- **Confidence:** ${(issue.confidence * 100).toFixed(0)}%`);
        lines.push(`- **Why:** ${issue.reason}`);
        if (issue.suggestion) lines.push(`- **Suggestion:** ${issue.suggestion.description}`);
        lines.push('');
        lines.push(issue.description);
        lines.push('');
      }
    }

    return {
      ok: true,
      value: { format: this.format, content: lines.join('\n'), mimeType: 'text/markdown' },
    };
  }
}

/** Renders the full adjudicated payload as machine-readable JSON. */
export class JsonReporter implements Reporter {
  readonly format = 'json' as const;

  async render(input: ReportInput): AsyncResult<Report> {
    const payload = {
      summary: input.summary,
      metrics: input.metrics,
      issues: sortIssues(input.issues.filter((i) => i.accepted)),
    };
    return {
      ok: true,
      value: {
        format: this.format,
        content: JSON.stringify(payload, null, 2),
        mimeType: 'application/json',
      },
    };
  }
}
