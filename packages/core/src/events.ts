/**
 * Typed event bus contract — the event-driven backbone (ARCHITECTURE §4).
 *
 * All cross-module communication flows through this bus. Events carry
 * *references/handles* to context, never raw context payloads, which is central
 * to token efficiency and keeps the bus lightweight.
 */

import type { AgentId, ContextHandle, IsoTimestamp, ReviewId, StageId, WorkflowId } from './ids.js';
import type { BudgetDimension } from './budget.js';
import type { TokenUsage } from './llm.js';

/** Discriminated union tag for every platform event. */
export type PlatformEventType =
  | 'review.requested'
  | 'review.planned'
  | 'context.build.requested'
  | 'context.built'
  | 'rules.completed'
  | 'routing.decided'
  | 'agent.dispatched'
  | 'agent.token.usage'
  | 'agent.completed'
  | 'critic.completed'
  | 'judge.completed'
  | 'report.generated'
  | 'review.published'
  | 'review.failed'
  | 'budget.exceeded'
  | 'cache.hit'
  | 'cache.miss';

/** Fields present on every event. */
export interface EventEnvelope<T extends PlatformEventType, P> {
  readonly type: T;
  readonly reviewId: ReviewId;
  readonly at: IsoTimestamp;
  /** Correlation id for tracing a single logical operation across stages. */
  readonly correlationId: string;
  readonly payload: P;
}

/* --- Payloads (kept minimal; carry handles, not context) --- */

export type ReviewRequestedEvent = EventEnvelope<
  'review.requested',
  { readonly workflowId: WorkflowId }
>;
export type ReviewPlannedEvent = EventEnvelope<
  'review.planned',
  { readonly stages: readonly StageId[] }
>;
export type ContextBuildRequestedEvent = EventEnvelope<
  'context.build.requested',
  Record<string, never>
>;
export type ContextBuiltEvent = EventEnvelope<'context.built', { readonly handle: ContextHandle }>;
export type RulesCompletedEvent = EventEnvelope<
  'rules.completed',
  { readonly findingCount: number }
>;
export type RoutingDecidedEvent = EventEnvelope<
  'routing.decided',
  { readonly agents: readonly AgentId[] }
>;
export type AgentDispatchedEvent = EventEnvelope<'agent.dispatched', { readonly agentId: AgentId }>;
export type AgentTokenUsageEvent = EventEnvelope<
  'agent.token.usage',
  { readonly agentId: AgentId; readonly usage: TokenUsage }
>;
export type AgentCompletedEvent = EventEnvelope<
  'agent.completed',
  { readonly agentId: AgentId; readonly issueCount: number }
>;
export type CriticCompletedEvent = EventEnvelope<
  'critic.completed',
  { readonly challengedCount: number }
>;
export type JudgeCompletedEvent = EventEnvelope<
  'judge.completed',
  { readonly acceptedCount: number; readonly rejectedCount: number }
>;
export type ReportGeneratedEvent = EventEnvelope<
  'report.generated',
  { readonly formats: readonly string[] }
>;
export type ReviewPublishedEvent = EventEnvelope<'review.published', { readonly target: string }>;
export type ReviewFailedEvent = EventEnvelope<
  'review.failed',
  { readonly code: string; readonly message: string }
>;
export type BudgetExceededEvent = EventEnvelope<
  'budget.exceeded',
  { readonly dimensions: readonly BudgetDimension[] }
>;
export type CacheHitEvent = EventEnvelope<'cache.hit', { readonly cache: string }>;
export type CacheMissEvent = EventEnvelope<'cache.miss', { readonly cache: string }>;

/** Union of all platform events. */
export type PlatformEvent =
  | ReviewRequestedEvent
  | ReviewPlannedEvent
  | ContextBuildRequestedEvent
  | ContextBuiltEvent
  | RulesCompletedEvent
  | RoutingDecidedEvent
  | AgentDispatchedEvent
  | AgentTokenUsageEvent
  | AgentCompletedEvent
  | CriticCompletedEvent
  | JudgeCompletedEvent
  | ReportGeneratedEvent
  | ReviewPublishedEvent
  | ReviewFailedEvent
  | BudgetExceededEvent
  | CacheHitEvent
  | CacheMissEvent;

/** Narrow an event union to a specific type. */
export type EventOf<T extends PlatformEventType> = Extract<PlatformEvent, { type: T }>;

export type Unsubscribe = () => void;

export type EventHandler<E extends PlatformEvent = PlatformEvent> = (
  event: E,
) => void | Promise<void>;

/**
 * The typed event bus. Implementations (in-memory for dev, distributed for
 * scale) live outside `core`; this contract keeps publishers/subscribers
 * decoupled from the transport.
 */
export interface EventBus {
  publish(event: PlatformEvent): void | Promise<void>;
  subscribe<T extends PlatformEventType>(type: T, handler: EventHandler<EventOf<T>>): Unsubscribe;
  /** Subscribe to every event (telemetry taps this off the critical path). */
  subscribeAll(handler: EventHandler): Unsubscribe;
}
