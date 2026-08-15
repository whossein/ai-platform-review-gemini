/**
 * Result / Either types.
 *
 * The platform prefers explicit, typed error handling over thrown exceptions
 * across contract boundaries. Implementations return `Result<T, E>` so that
 * callers must handle both branches. Helpers live in `shared`.
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E = PlatformError> = Ok<T> | Err<E>;

/** Async variant, used by most I/O-bound contracts. */
export type AsyncResult<T, E = PlatformError> = Promise<Result<T, E>>;

/** Canonical error categories across the platform. */
export type ErrorCategory =
  | 'validation'
  | 'not_found'
  | 'unauthorized'
  | 'provider'
  | 'budget_exceeded'
  | 'timeout'
  | 'cache'
  | 'io'
  | 'internal';

/** Structured platform error carried in the `Err` branch. */
export interface PlatformError {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly message: string;
  /** Optional machine-readable context; never include secrets. */
  readonly details?: Readonly<Record<string, unknown>>;
  /** Original cause, if any (for logging/telemetry). */
  readonly cause?: unknown;
  /** Whether a retry could plausibly succeed. */
  readonly retryable?: boolean;
}
