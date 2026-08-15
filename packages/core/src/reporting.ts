/**
 * Reporting contracts.
 *
 * Renders adjudicated findings to multiple formats: Markdown, JSON, HTML,
 * GitLab discussions, summary, metrics. Renderers are pluggable; new formats
 * register without core changes.
 */

import type { AsyncResult } from './result.js';
import type { AdjudicatedIssue } from './issue.js';
import type { ReviewMetrics } from './telemetry.js';

export type ReportFormat = 'markdown' | 'json' | 'html' | 'gitlab_discussions' | 'summary';

/** The adjudicated data a report is rendered from. */
export interface ReportInput {
  readonly issues: readonly AdjudicatedIssue[];
  readonly metrics: ReviewMetrics;
  /** Short, structured overview produced by the Reporter agent. */
  readonly summary: string;
}

/** A rendered report artifact. */
export interface Report {
  readonly format: ReportFormat;
  /** Rendered content; for `gitlab_discussions` this is a structured payload. */
  readonly content: string;
  readonly mimeType: string;
}

/** A single format renderer. Implementations live in `reporting`. */
export interface Reporter {
  readonly format: ReportFormat;
  render(input: ReportInput): AsyncResult<Report>;
}

export interface ReporterRegistry {
  register(reporter: Reporter): void;
  get(format: ReportFormat): Reporter | undefined;
  list(): readonly ReportFormat[];
}

/**
 * Publishes a report to a destination (e.g., GitLab discussions on an MR).
 * Publishers are provider-aware and live in `reporting`/`git`.
 */
export interface Publisher {
  publish(report: Report, target: Readonly<Record<string, unknown>>): AsyncResult<void>;
}
