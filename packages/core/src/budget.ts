/**
 * Cost governance contracts.
 *
 * Every review carries a budget triplet. The Planner allocates budget across
 * stages; the workflow engine enforces it; telemetry records actuals. Exceeding
 * budget degrades gracefully rather than failing hard. (See ARCHITECTURE §13.)
 */

/** The three independent budget dimensions enforced per review. */
export interface Budget {
  /** Maximum total tokens (prompt + completion) across the whole review. */
  readonly tokenBudget: number;
  /** Maximum spend in USD across the whole review. */
  readonly dollarBudget: number;
  /** Maximum wall-clock / step budget in milliseconds. */
  readonly executionBudgetMs: number;
}

/** A running tally of consumption against a `Budget`. */
export interface BudgetUsage {
  readonly tokensUsed: number;
  readonly dollarsSpent: number;
  readonly elapsedMs: number;
}

/** Which dimension(s) of a budget were exceeded. */
export type BudgetDimension = 'token' | 'dollar' | 'execution';

export interface BudgetStatus {
  readonly budget: Budget;
  readonly usage: BudgetUsage;
  readonly remainingTokens: number;
  readonly remainingDollars: number;
  readonly remainingMs: number;
  readonly exceeded: readonly BudgetDimension[];
}

/**
 * Enforces budgets at stage transitions. Implementations live in
 * `workflow-engine`; this contract keeps the enforcement policy pluggable.
 */
export interface BudgetGuard {
  /** Current status snapshot. */
  status(): BudgetStatus;
  /** Record additional consumption. Returns the updated status. */
  record(delta: Partial<BudgetUsage>): BudgetStatus;
  /** Whether an operation with the estimated cost may proceed. */
  canAfford(estimate: Partial<BudgetUsage>): boolean;
}
