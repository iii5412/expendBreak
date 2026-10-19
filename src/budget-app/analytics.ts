import { calculateBudget } from '../lib/calculator';
import type { BudgetCalculationInput } from '../types/budget';

/** Posted rows only. The adapter has already removed transfers and card settlements. */
export function buildBudgetAnalytics(input: BudgetCalculationInput, names: Record<string, string>) {
  const period = calculateBudget(input);
  const rows = input.transactions.filter(
    (t) => t.budgetPeriodKey === period.budgetPeriodKey && t.localDate <= input.today,
  );
  const expenses = rows.filter((t) => t.type === 'expense');
  const totals = new Map<string, { amount: number; variable: number; count: number }>();
  for (const row of expenses) {
    const id = row.categoryId || 'uncategorized';
    const total = totals.get(id) || { amount: 0, variable: 0, count: 0 };
    total.amount += row.amount;
    if (row.expenseNature === 'variable') {
      total.variable += row.amount;
      total.count++;
    }
    totals.set(id, total);
  }
  const categoryIds = new Set([
    ...totals.keys(),
    ...Object.keys(input.settings.categoryAmountLimits || {}),
    ...Object.keys(input.settings.categoryCountLimits || {}),
  ]);
  const categories = [...categoryIds]
    .map((id) => ({
      id,
      name: names[id] || '기타',
      amount: totals.get(id)?.amount || 0,
      variable: totals.get(id)?.variable || 0,
      count: totals.get(id)?.count || 0,
      budget: input.settings.categoryAmountLimits?.[id] || 0,
      coupons: input.settings.categoryCountLimits?.[id] || 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  // Explicit cycle assignment wins over posting date, including an early salary-cycle charge.
  const daily = new Map<string, number>();
  for (const row of expenses.filter((t) => t.expenseNature === 'variable')) {
    const date = row.localDate < period.periodStart ? period.periodStart : row.localDate;
    daily.set(date, (daily.get(date) || 0) + row.amount);
  }
  let cumulative = 0;
  const days: Array<{ date: string; spent: number | null; limit: number }> = [];
  for (
    let cursor = Date.parse(`${period.periodStart}T00:00:00Z`);
    cursor <= Date.parse(`${period.periodEnd}T00:00:00Z`);
    cursor += 86_400_000
  ) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    cumulative += daily.get(date) || 0;
    days.push({ date, spent: date <= input.today ? cumulative : null, limit: input.settings.variableExpenseLimit });
  }
  return {
    start: period.periodStart,
    end: period.periodEnd,
    days,
    categories,
    income: rows.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0),
    expense: expenses.reduce((sum, t) => sum + t.amount, 0),
  };
}
