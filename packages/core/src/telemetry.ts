/**
 * Telemetry contracts.
 *
 * Tracked per review and per agent: execution time, prompt/completion tokens,
 * cost, cache hits/misses, agent accuracy, false-positive rate, acceptance rate.
 * Telemetry taps the event bus and never sits on the critical path
 * (ARCHITECTURE §14).
 */

import type { AgentId, ReviewId } from './ids.js';

/** Per-agent metrics for a single review. */
export interface AgentMetrics {
  readonly agentId: AgentId;
  readonly executionMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
}

/** Aggregate metrics for a whole review. */
export interface ReviewMetrics {
  readonly reviewId: ReviewId;
  readonly totalExecutionMs: number;
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalCostUsd: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly agents: readonly AgentMetrics[];
}

/** Learning metrics accumulated across reviews (fed by the knowledge system). */
export interface QualityMetrics {
  readonly agentAccuracy: number;
  readonly falsePositiveRate: number;
  readonly acceptanceRate: number;
}

/** A single numeric measurement emitted during execution. */
export interface Metric {
  readonly name: string;
  readonly value: number;
  readonly tags?: Readonly<Record<string, string>>;
  readonly at: number;
}

/** Sink for metrics. Backends (stdout, OTLP, etc.) live outside `core`. */
export interface TelemetrySink {
  record(metric: Metric): void;
  reviewMetrics(reviewId: ReviewId): ReviewMetrics | undefined;
}
