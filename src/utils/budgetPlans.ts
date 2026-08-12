import { Budget } from '../types';

/** New months inherit the nearest earlier DB budget, then the saved profile default. */
export function resolveInheritedAllowanceLimit(
  targetYearMonth: string,
  budgets: Budget[],
  profileDefault?: number | null,
): number {
  const previous = budgets
    .filter(item => item.yearMonth < targetYearMonth && Number.isFinite(item.totalLimit))
    .sort((left, right) => right.yearMonth.localeCompare(left.yearMonth))[0];
  const value = previous?.totalLimit ?? profileDefault ?? 0;
  return Math.max(0, Math.round(Number(value) || 0));
}
