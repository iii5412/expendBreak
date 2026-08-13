import { Category, CycleBaseline, RecurringOccurrence, Transaction } from '../types';
import {
  AccountingPeriod,
  getAccountingPeriod,
  getCategoryBreakdown,
  isDateInPeriod,
  shiftYearMonth,
} from './calculations';

/**
 * Closes out the cycle that just ended: what was planned against what happened.
 *
 * The plan locked on payday is only worth something if the user sees how it
 * turned out, and the leftover is the natural starting point for next cycle's
 * savings target. Requires a baseline — without a committed plan there is
 * nothing to compare against.
 */

export interface CycleClosingCategory {
  categoryName: string;
  color: string;
  amount: number;
  percent: number;
  /** Change against the same category one cycle earlier. */
  delta: number;
}

export interface CycleClosingReport {
  yearMonth: string;
  period: AccountingPeriod;
  plannedLivingBudget: number;
  actualSpend: number;
  /** planned - actual. Negative means the cycle overran. */
  leftover: number;
  topCategories: CycleClosingCategory[];
  /** Recurring items that were never confirmed or skipped. */
  unresolvedOccurrences: RecurringOccurrence[];
}

export function buildCycleClosingReport(
  yearMonth: string,
  baseline: CycleBaseline | null,
  transactions: Transaction[],
  occurrences: RecurringOccurrence[],
  categories: Category[],
  monthStartDay: number = 1,
  now = new Date(),
): CycleClosingReport | null {
  if (!baseline || baseline.yearMonth !== yearMonth) return null;

  const period = getAccountingPeriod(yearMonth, monthStartDay, now);
  const categoryMap = Object.fromEntries(
    categories.map(category => [
      category.id,
      { name: category.name, color: category.color, icon: category.icon, type: category.type },
    ]),
  );

  const breakdown = getCategoryBreakdown(yearMonth, transactions, categoryMap, {
    variableOnly: true,
    monthStartDay,
  });
  const previousBreakdown = getCategoryBreakdown(
    shiftYearMonth(yearMonth, -1),
    transactions,
    categoryMap,
    { variableOnly: true, monthStartDay },
  );
  const previousByName = new Map(previousBreakdown.map(item => [item.categoryName, item.amount]));

  const actualSpend = breakdown.reduce((sum, item) => sum + item.amount, 0);

  return {
    yearMonth,
    period,
    plannedLivingBudget: baseline.livingBudget,
    actualSpend,
    leftover: baseline.livingBudget - actualSpend,
    topCategories: breakdown.slice(0, 3).map(item => ({
      categoryName: item.categoryName,
      color: item.color,
      amount: item.amount,
      percent: item.percent,
      delta: item.amount - (previousByName.get(item.categoryName) || 0),
    })),
    unresolvedOccurrences: occurrences.filter(occurrence =>
      isDateInPeriod(occurrence.scheduledDate, period)
      && occurrence.status !== 'posted'
      && occurrence.status !== 'skipped'),
  };
}
