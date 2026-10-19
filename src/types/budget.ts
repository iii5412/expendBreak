/** Task 1 domain model. Independent of the existing persisted account schema. */
export type LocalDate = string; // Valid YYYY-MM-DD, local calendar date (no timezone conversion).
export type BudgetPeriodKey = string; // YYYY-MM of the period's start date.
export type ExpenseNature = 'fixed' | 'variable';

export interface BudgetSettings {
  monthStartDay: number; // Integer, 1..28.
  variableExpenseLimit: number;
  categoryCountLimits?: Record<string, number>;
  categoryAmountLimits?: Record<string, number>;
}

export interface BudgetTransaction {
  source?: 'manual' | 'ai';
  aiConfidence?: number;
  aiReviewed?: boolean;
  id: string;
  localDate: LocalDate;
  /** Explicit assignment takes precedence over the actual posting date. */
  budgetPeriodKey: BudgetPeriodKey;
  type: 'income' | 'expense';
  amount: number;
  expenseNature: ExpenseNature;
  isOneOff: boolean;
  categoryId?: string;
  merchant?: string;
  memo?: string;
}

export interface BudgetRecurringTemplate {
  id: string;
  active: boolean;
  type: 'income' | 'expense';
  expenseNature: ExpenseNature;
  amount: number;
}

export interface BudgetOccurrence {
  id: string;
  templateId: string;
  localDate: LocalDate;
  budgetPeriodKey: BudgetPeriodKey;
  type: 'income' | 'expense';
  expenseNature: ExpenseNature;
  amount: number;
  /** Posted occurrences are represented by transactions and never counted twice. */
  status: 'pending' | 'posted' | 'skipped';
}

export interface BudgetCalculationInput {
  /** Existing payday history may define a transition or early-start period. */
  period?: { key: BudgetPeriodKey; start: LocalDate; end: LocalDate };
  today: LocalDate;
  /** First date with complete transaction coverage, including zero-spend days. */
  observationStartDate: LocalDate;
  settings: BudgetSettings;
  transactions: readonly BudgetTransaction[];
  templates: readonly BudgetRecurringTemplate[];
  occurrences: readonly BudgetOccurrence[];
}

export interface BudgetCalculation {
  budgetPeriodKey: BudgetPeriodKey;
  periodStart: LocalDate;
  periodEnd: LocalDate;
  remainingDaysIncludingToday: number;
  fixedExpenseBudget: number;
  variableExpenseLimit: number;
  actualVariableBeforeToday: number;
  actualVariableToday: number;
  pendingVariableExpense: number;
  safeBalanceAtStartOfDay: number;
  currentSafeBalance: number;
  todayAllowance: number;
  remainingToday: number;
  /** null on the final day of the period. */
  projectedTomorrowAllowance: number | null;
  confirmedFixedExpense: number;
  pendingFixedExpense: number;
  accumulatedOneOffExpense: number;
  accumulatedDailyVariableExpense: number;
  burnRateObservationDays: number;
  dailyBurnRate: number | null;
  forecastStatus: 'ready' | 'insufficient_data';
  /** null until at least three calendar days have been observed. */
  projectedPeriodEndExpense: number | null;
}
