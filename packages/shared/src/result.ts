/**
 * Result helpers (implementations of the `core` Result contract).
 *
 * Constructors and combinators for the platform's typed error handling. Keeping
 * these here (not in `core`) preserves core's "contracts only" rule (ADR-0002).
 */

import type { Result, PlatformError, ErrorCategory } from '@ai-review/core';

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E = PlatformError>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Builds a structured `PlatformError` with a category, code, and message. */
export function error(
  category: ErrorCategory,
  code: string,
  message: string,
  extra?: Omit<PlatformError, 'category' | 'code' | 'message'>,
): PlatformError {
  return { category, code, message, ...extra };
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

/** Maps the success value, leaving errors untouched. */
export function map<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? { ok: true, value: fn(r.value) } : r;
}

/** Returns the value or a fallback when the result is an error. */
export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}
