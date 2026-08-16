/**
 * Reservable budget guard & retry policy helpers.
 *
 * Enforces atomic pre-execution budget reservations so parallel agent stages
 * cannot collectively overspend the configured token/dollar/time budget.
 */

import type {
  Budget,
  BudgetDimension,
  BudgetGuard,
  BudgetStatus,
  BudgetUsage,
  PlatformError,
} from '@ai-review/core';

export interface BudgetReservation {
  readonly id: string;
  readonly tokens: number;
  readonly dollars: number;
  readonly timestamp: number;
}

export function makeBudgetGuard(budget: Budget): BudgetGuard {
  return new ReservableBudgetGuard(budget);
}

export class ReservableBudgetGuard implements BudgetGuard {

  private readonly usage = { tokensUsed: 0, dollarsSpent: 0 };
  private readonly reservations = new Map<string, BudgetReservation>();
  private readonly startedAt: number;

  constructor(
    private readonly budget: Budget,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.startedAt = this.now();
  }

  status(): BudgetStatus {
    const elapsedMs = this.now() - this.startedAt;
    const reservedTokens = this.totalReservedTokens();
    const reservedDollars = this.totalReservedDollars();

    const effectiveTokens = this.usage.tokensUsed + reservedTokens;
    const effectiveDollars = this.usage.dollarsSpent + reservedDollars;

    const exceeded: BudgetDimension[] = [];
    if (effectiveTokens > this.budget.tokenBudget) exceeded.push('token');
    if (effectiveDollars > this.budget.dollarBudget) exceeded.push('dollar');
    if (elapsedMs > this.budget.executionBudgetMs) exceeded.push('execution');

    return {
      budget: this.budget,
      usage: {
        tokensUsed: this.usage.tokensUsed,
        dollarsSpent: this.usage.dollarsSpent,
        elapsedMs,
      },
      remainingTokens: Math.max(0, this.budget.tokenBudget - effectiveTokens),
      remainingDollars: Math.max(0, this.budget.dollarBudget - effectiveDollars),
      remainingMs: Math.max(0, this.budget.executionBudgetMs - elapsedMs),
      exceeded,
    };
  }

  record(delta: Partial<BudgetUsage>): BudgetStatus {
    this.usage.tokensUsed += delta.tokensUsed ?? 0;
    this.usage.dollarsSpent += delta.dollarsSpent ?? 0;
    return this.status();
  }

  canAfford(estimate: Partial<BudgetUsage>): boolean {
    const estimatedTokens = estimate.tokensUsed ?? 0;
    const estimatedDollars = estimate.dollarsSpent ?? 0;
    const elapsedMs = this.now() - this.startedAt;

    const effectiveTokens = this.usage.tokensUsed + this.totalReservedTokens() + estimatedTokens;
    const effectiveDollars = this.usage.dollarsSpent + this.totalReservedDollars() + estimatedDollars;

    return (
      effectiveTokens <= this.budget.tokenBudget &&
      effectiveDollars <= this.budget.dollarBudget &&
      elapsedMs <= this.budget.executionBudgetMs
    );
  }

  /**
   * Pre-execution budget reservation.
   * Atomically allocates budget before an agent stage runs.
   */
  reserve(estimate: { tokens?: number; dollars?: number }): { ok: true; reservationId: string } | { ok: false; reason: string } {
    const tokens = estimate.tokens ?? 0;
    const dollars = estimate.dollars ?? 0;
    const elapsedMs = this.now() - this.startedAt;

    if (elapsedMs > this.budget.executionBudgetMs) {
      return { ok: false, reason: 'Execution time budget exceeded' };
    }

    const nextTokens = this.usage.tokensUsed + this.totalReservedTokens() + tokens;
    if (nextTokens > this.budget.tokenBudget) {
      return { ok: false, reason: `Token budget insufficient (needs ${tokens}, remaining ${Math.max(0, this.budget.tokenBudget - (this.usage.tokensUsed + this.totalReservedTokens()))})` };
    }

    const nextDollars = this.usage.dollarsSpent + this.totalReservedDollars() + dollars;
    if (nextDollars > this.budget.dollarBudget) {
      return { ok: false, reason: `Dollar budget insufficient (needs $${dollars.toFixed(4)}, remaining $${Math.max(0, this.budget.dollarBudget - (this.usage.dollarsSpent + this.totalReservedDollars())).toFixed(4)})` };
    }

    const reservationId = `res_${Math.random().toString(36).slice(2, 10)}_${this.now()}`;
    this.reservations.set(reservationId, {
      id: reservationId,
      tokens,
      dollars,
      timestamp: this.now(),
    });

    return { ok: true, reservationId };
  }

  /**
   * Post-execution reconciliation.
   * Releases the reservation and records actual usage.
   */
  reconcile(reservationId: string, actual: Partial<BudgetUsage>): BudgetStatus {
    this.reservations.delete(reservationId);
    return this.record(actual);
  }

  /**
   * Releases an unused reservation (e.g. on abort or error before LLM call).
   */
  release(reservationId: string): void {
    this.reservations.delete(reservationId);
  }

  private totalReservedTokens(): number {
    let sum = 0;
    for (const r of this.reservations.values()) sum += r.tokens;
    return sum;
  }

  private totalReservedDollars(): number {
    let sum = 0;
    for (const r of this.reservations.values()) sum += r.dollars;
    return sum;
  }
}

/**
 * Determines whether a failure is transient and eligible for retry.
 * Non-transient errors (authentication, validation, bad JSON, budget exhaustion) fail fast.
 */
export function isTransientError(error: PlatformError): boolean {
  if (error.retryable !== undefined) return error.retryable;
  if (error.category === 'timeout') return true;
  if (
    error.category === 'validation' ||
    error.category === 'unauthorized' ||
    error.category === 'budget_exceeded' ||
    error.category === 'not_found'
  ) {
    return false;
  }

  const code = (error.code ?? '').toLowerCase();
  if (
    code.includes('rate_limit') ||
    code.includes('timeout') ||
    code.includes('server_error') ||
    code.includes('service_unavailable') ||
    code.includes('econnreset') ||
    code.includes('etimedout') ||
    code.includes('transient')
  ) {
    return true;
  }

  const msg = (error.message ?? '').toLowerCase();
  if (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('temporary')
  ) {
    return true;
  }

  return false;
}
