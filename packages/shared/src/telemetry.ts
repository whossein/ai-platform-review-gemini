/**
 * In-memory telemetry sink (ARCHITECTURE §14).
 *
 * Collects point metrics and per-review aggregates off the critical path. A
 * production sink (OTLP, StatsD, stdout) implements the same `TelemetrySink`
 * contract. This one is used in tests and the offline CLI.
 */

import type { Metric, ReviewId, ReviewMetrics, TelemetrySink } from '@ai-review/core';

export class InMemoryTelemetrySink implements TelemetrySink {
  private readonly metrics: Metric[] = [];
  private readonly reviews = new Map<ReviewId, ReviewMetrics>();

  record(metric: Metric): void {
    this.metrics.push(metric);
  }

  /** Records/overwrites the aggregate metrics for a review. */
  setReviewMetrics(metrics: ReviewMetrics): void {
    this.reviews.set(metrics.reviewId, metrics);
  }

  reviewMetrics(reviewId: ReviewId): ReviewMetrics | undefined {
    return this.reviews.get(reviewId);
  }

  /** All point metrics recorded so far (for assertions / debugging). */
  all(): readonly Metric[] {
    return this.metrics;
  }

  /** Sum of a named metric across all recorded points. */
  sum(name: string): number {
    return this.metrics.filter((m) => m.name === name).reduce((acc, m) => acc + m.value, 0);
  }
}
