import { Transaction, RecurringOccurrence, RecurringTemplate, Budget, BudgetAlertLevel } from '../types';

export interface MonthSummary {
  yearMonth: string; // YYYY-MM
  daysInMonth: number;
  daysPassed: number;
  daysRemaining: number;
  
  // Income
  confirmedIncome: number;
  confirmedRecurringIncome: number;
  scheduledIncome: number;
  totalExpectedRecurringIncome: number;
  totalIncome: number;
  
  // Expenses
  confirmedExpenses: number;
  confirmedFixedExpenses: number;
  confirmedVariableExpenses: number;
  remainingScheduledExpenses: number;
  totalExpectedFixedExpenses: number;
  
  // Cash Flow
  netCashFlow: number; // Confirmed Income - Confirmed Expenses
  expectedEndMonthCashFlow: number;
  
  // Budget Control
  allowanceLimit: number;
  spendableLimit: number;
  remainingAllowance: number;
  disposableAfterFixed: number;
  plannedSavings: number;
  allowanceOverCapacity: number;
  monthlyBudgetLimit: number; // Backward-compatible alias for allowanceLimit
  simpleRemainingLimit: number; // Backward-compatible alias for remainingAllowance
  safetyBalance: number; // Backward-compatible alias for remainingAllowance
  dailySafeAllowance: number; // max(0, Math.floor(Remaining Allowance / Days Remaining))
  
  // Progress & Status
  budgetUsagePercent: number;
  alertLevel: BudgetAlertLevel;
  
  // Month-end Forecast
  forecastMonthEndSpend: number | null; // null if insufficient data (< 3 days)
  forecastVariableSpend: number | null;
  forecastSavings: number | null;
  forecastAverageDailyVariable: number;
}

/**
 * Helper to get current local date in YYYY-MM-DD
 */
export function getLocalDateString(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Helper to get YYYY-MM string
 */
export function getYearMonthString(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The accounting period a `YYYY-MM` label refers to.
 *
 * With the default `monthStartDay` of 1 this is exactly the calendar month.
 * A salaried user paid on the 25th sets `monthStartDay` to 25, and the period
 * labelled `2026-08` then runs 2026-08-25 ~ 2026-09-24: the cycle is named
 * after the month it starts in, which keeps day 1 identical to the old behavior.
 */
export interface AccountingPeriod {
  yearMonth: string;
  monthStartDay: number;
  startDate: string; // inclusive, YYYY-MM-DD
  endDate: string; // inclusive, YYYY-MM-DD
  daysInMonth: number; // total days in the period
  daysPassed: number;
  daysRemaining: number; // includes today
}

/** Days 29-31 do not exist in every month, so the cycle start is capped at 28. */
export function normalizeMonthStartDay(monthStartDay?: number | null): number {
  const parsed = Math.trunc(Number(monthStartDay));
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(28, Math.max(1, parsed));
}

/** Adds `offset` months to a `YYYY-MM` label. */
export function shiftYearMonth(yearMonth: string, offset: number): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const shifted = new Date(year, month - 1 + offset, 1);
  return getYearMonthString(shifted);
}

export function getAccountingPeriod(
  yearMonth: string,
  monthStartDay: number = 1,
  now = new Date(),
): AccountingPeriod {
  const startDay = normalizeMonthStartDay(monthStartDay);
  const [year, month] = yearMonth.split('-').map(Number);

  const start = new Date(year, month - 1, startDay);
  const nextStart = new Date(year, month, startDay);
  const end = new Date(nextStart.getTime() - MS_PER_DAY);

  const startDate = getLocalDateString(start);
  const endDate = getLocalDateString(end);
  const daysInMonth = Math.round((nextStart.getTime() - start.getTime()) / MS_PER_DAY);

  const today = getLocalDateString(now);
  let daysPassed: number;
  if (today < startDate) {
    daysPassed = 0;
  } else if (today > endDate) {
    daysPassed = daysInMonth;
  } else {
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    daysPassed = Math.round((todayMidnight.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  }

  return {
    yearMonth,
    monthStartDay: startDay,
    startDate,
    endDate,
    daysInMonth,
    daysPassed,
    // Days remaining includes today
    daysRemaining: Math.max(1, daysInMonth - daysPassed + 1),
  };
}

export function isDateInPeriod(localDate: string, period: AccountingPeriod): boolean {
  return localDate >= period.startDate && localDate <= period.endDate;
}

/** Returns the monthly due date that belongs to this payday period. */
export function getMonthlyDueDateInPeriod(dayOfMonth: number, period: AccountingPeriod): string | null {
  const calendarMonths = [...new Set([period.startDate.slice(0, 7), period.endDate.slice(0, 7)])];
  for (const yearMonth of calendarMonths) {
    const [year, month] = yearMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const day = Math.min(lastDay, Math.max(1, Math.trunc(dayOfMonth)));
    const candidate = `${yearMonth}-${String(day).padStart(2, '0')}`;
    if (isDateInPeriod(candidate, period)) return candidate;
  }
  return null;
}

/** Which period a date belongs to, e.g. 2026-09-02 with start day 25 -> 2026-08. */
export function getYearMonthForDate(localDate: string, monthStartDay: number = 1): string {
  const startDay = normalizeMonthStartDay(monthStartDay);
  const calendarMonth = localDate.slice(0, 7);
  const day = Number(localDate.slice(8, 10));
  return day >= startDay ? calendarMonth : shiftYearMonth(calendarMonth, -1);
}

/** The period that contains today. Equals {@link getYearMonthString} when the start day is 1. */
export function getCurrentYearMonth(monthStartDay: number = 1, now = new Date()): string {
  return getYearMonthForDate(getLocalDateString(now), monthStartDay);
}

/** Short label such as `8/25~9/24`, omitted when the period is a plain calendar month. */
export function formatPeriodRange(period: AccountingPeriod): string {
  if (period.monthStartDay === 1) return '';
  const short = (date: string) => {
    const [, month, day] = date.split('-').map(Number);
    return `${month}/${day}`;
  };
  return `${short(period.startDate)}~${short(period.endDate)}`;
}

/**
 * Calculate total days in a period and days remaining.
 * Retained for callers that only need the day counts.
 */
export function getMonthDaysInfo(yearMonth: string, now = new Date(), monthStartDay: number = 1) {
  const { daysInMonth, daysPassed, daysRemaining } = getAccountingPeriod(yearMonth, monthStartDay, now);
  return { daysInMonth, daysPassed, daysRemaining };
}

/**
 * Calculate full month summary and financial metrics
 */
export function calculateMonthSummary(
  yearMonth: string,
  transactions: Transaction[],
  occurrences: RecurringOccurrence[],
  budget: Budget,
  templates: RecurringTemplate[] = [],
  now = new Date(),
  monthStartDay: number = 1,
): MonthSummary {
  const period = getAccountingPeriod(yearMonth, monthStartDay, now);
  const { daysInMonth, daysPassed, daysRemaining } = period;
  const templateMap = new Map(templates.map(t => [t.id, t]));

  // Filter transactions inside this accounting period
  const monthTxs = transactions.filter(t => isDateInPeriod(t.localDate, period));

  // Confirmed Income
  const confirmedIncome = monthTxs
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + Math.round(t.amount), 0);

  const confirmedRecurringIncome = monthTxs
    .filter(t => t.type === 'income' && t.recurringTemplateId)
    .reduce((sum, t) => sum + Math.round(t.amount), 0);

  // Confirmed Expenses
  const confirmedExpenses = monthTxs
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + Math.round(t.amount), 0);

  // Confirmed Fixed Expenses (expenses originating from recurring templates)
  const confirmedFixedExpenses = monthTxs
    .filter(t => t.type === 'expense' && t.recurringTemplateId)
    .reduce((sum, t) => sum + Math.round(t.amount), 0);

  // Allowance spending excludes expenses already committed through recurring templates.
  const confirmedVariableExpenses = monthTxs
    .filter(t => t.type === 'expense' && !t.recurringTemplateId)
    .reduce((sum, t) => sum + Math.round(t.amount), 0);

  // Filter pending occurrences for scheduled / needs_confirmation / overdue in this month
  const pendingOccurrences = occurrences.filter(
    o => isDateInPeriod(o.scheduledDate, period)
      && (o.status === 'scheduled' || o.status === 'needs_confirmation' || o.status === 'overdue')
  );

  // Scheduled Income (recurring items with template.type === 'income')
  const scheduledIncome = pendingOccurrences
    .filter(o => {
      const tmpl = templateMap.get(o.templateId);
      return (o.typeSnapshot ?? tmpl?.type) === 'income';
    })
    .reduce((sum, o) => sum + Math.round(o.actualAmount ?? o.expectedAmount), 0);

  // Remaining Scheduled Expenses (recurring items with template.type === 'expense' or fallback)
  const scheduledOccurrenceExpenses = pendingOccurrences
    .filter(o => {
      const tmpl = templateMap.get(o.templateId);
      return (o.typeSnapshot ?? tmpl?.type) === 'expense';
    })
    .reduce((sum, o) => sum + Math.round(o.actualAmount ?? o.expectedAmount), 0);

  // Occurrences are normally generated before this calculation. Keep the plan
  // safe even when a newly registered template has not materialized yet: every
  // active monthly fixed expense due in the salary cycle is reserved once.
  const occurrenceTemplateIds = new Set(
    occurrences
      .filter(o => isDateInPeriod(o.scheduledDate, period))
      .map(o => o.templateId),
  );
  const transactionTemplateIds = new Set(
    monthTxs
      .filter(t => t.type === 'expense' && t.recurringTemplateId)
      .map(t => t.recurringTemplateId as string),
  );
  const unmaterializedFixedExpenses = templates
    .filter(template => {
      if (!template.active || template.type !== 'expense' || template.frequency !== 'monthly') return false;
      if (occurrenceTemplateIds.has(template.id) || transactionTemplateIds.has(template.id)) return false;
      const dueDate = getMonthlyDueDateInPeriod(template.dayOfMonth, period);
      return Boolean(
        dueDate
        && dueDate >= template.startDate
        && (!template.endDate || dueDate <= template.endDate),
      );
    })
    .reduce((sum, template) => sum + Math.round(template.defaultAmount), 0);
  const remainingScheduledExpenses = scheduledOccurrenceExpenses + unmaterializedFixedExpenses;

  // Spending starts only after money has actually arrived. Registered future
  // income remains informational and never increases the usable balance.
  const totalIncome = confirmedIncome;
  const totalExpectedRecurringIncome = confirmedRecurringIncome + scheduledIncome;
  const totalExpectedFixedExpenses = confirmedFixedExpenses + remainingScheduledExpenses;
  
  // Cash flows
  const netCashFlow = confirmedIncome - confirmedExpenses;
  
  // Allowance control. Keep Budget.totalLimit persisted as-is and reinterpret it as
  // the user-controlled allowance limit so existing records require no migration.
  const allowanceLimit = Math.round(budget.totalLimit);
  const disposableAfterFixed = totalIncome - totalExpectedFixedExpenses;
  const spendableLimit = Math.max(0, Math.min(allowanceLimit, disposableAfterFixed));
  const remainingAllowance = spendableLimit - confirmedVariableExpenses;
  const plannedSavings = disposableAfterFixed - allowanceLimit;
  const allowanceOverCapacity = Math.max(0, -plannedSavings);

  // Backward-compatible aliases for existing API/AI consumers.
  const monthlyBudgetLimit = allowanceLimit;
  const simpleRemainingLimit = remainingAllowance;
  const safetyBalance = remainingAllowance;
  
  // Daily Safe Spending Allowance: max(0, floor(remainingAllowance / daysRemaining))
  const dailySafeAllowance = Math.max(0, Math.floor(remainingAllowance / Math.max(1, daysRemaining)));
  
  // Allowance Usage %
  const budgetUsagePercent = spendableLimit > 0
    ? Math.min(999, Math.round((confirmedVariableExpenses / spendableLimit) * 100))
    : confirmedVariableExpenses > 0 ? 999 : 0;
    
  // Alert Level
  let alertLevel: BudgetAlertLevel = 'safe';
  const [cautionThreshold = 0.7, warningThreshold = 0.85, dangerThreshold = 1] = budget.thresholds || [];
  if (budgetUsagePercent >= dangerThreshold * 100) {
    alertLevel = 'danger';
  } else if (budgetUsagePercent >= warningThreshold * 100) {
    alertLevel = 'warning';
  } else if (budgetUsagePercent >= cautionThreshold * 100) {
    alertLevel = 'caution';
  }
  
  // Forecast Month-End Spend based on recent 14 days variable spend average
  // Variable spend = non-fixed expense transactions
  const variableTxs = monthTxs.filter(t => t.type === 'expense' && !t.recurringTemplateId);
  let forecastMonthEndSpend: number | null = null;
  let forecastVariableSpend: number | null = null;
  let forecastAverageDailyVariable = 0;
  
  if (daysPassed >= 3) {
    // Recent 14-day window measured from the period start, not the calendar month.
    const endOffset = Math.min(daysInMonth, daysPassed);
    const startOffset = Math.max(1, endOffset - 13);
    const dayFromPeriodStart = (offset: number) => {
      const [year, month, day] = period.startDate.split('-').map(Number);
      return getLocalDateString(new Date(year, month - 1, day + offset - 1));
    };
    const recentStart = dayFromPeriodStart(startOffset);
    const recentEnd = dayFromPeriodStart(endOffset);
    const recentVariableSpend = variableTxs
      .filter(transaction => transaction.localDate >= recentStart && transaction.localDate <= recentEnd)
      .reduce((sum, transaction) => sum + Math.round(transaction.amount), 0);
    const observedDays = endOffset - startOffset + 1;
    forecastAverageDailyVariable = Math.round(recentVariableSpend / observedDays);
    
    forecastVariableSpend = confirmedVariableExpenses + Math.round(forecastAverageDailyVariable * (daysRemaining - 1));
    forecastMonthEndSpend = totalExpectedFixedExpenses + forecastVariableSpend;
  }
  
  const forecastSavings = forecastMonthEndSpend === null ? null : totalIncome - forecastMonthEndSpend;
  const expectedEndMonthCashFlow = forecastSavings ?? (totalIncome - totalExpectedFixedExpenses - confirmedVariableExpenses);

  return {
    yearMonth,
    daysInMonth,
    daysPassed,
    daysRemaining,
    confirmedIncome,
    confirmedRecurringIncome,
    scheduledIncome,
    totalExpectedRecurringIncome,
    totalIncome,
    confirmedExpenses,
    confirmedFixedExpenses,
    confirmedVariableExpenses,
    remainingScheduledExpenses,
    totalExpectedFixedExpenses,
    netCashFlow,
    expectedEndMonthCashFlow,
    allowanceLimit,
    spendableLimit,
    remainingAllowance,
    disposableAfterFixed,
    plannedSavings,
    allowanceOverCapacity,
    monthlyBudgetLimit,
    simpleRemainingLimit,
    safetyBalance,
    dailySafeAllowance,
    budgetUsagePercent,
    alertLevel,
    forecastMonthEndSpend,
    forecastVariableSpend,
    forecastSavings,
    forecastAverageDailyVariable,
  };
}

/**
 * Format KRW currency string e.g. 24,900원
 */
export function formatKRW(amount: number): string {
  const formatted = new Intl.NumberFormat('ko-KR').format(Math.round(amount));
  return `${formatted}원`;
}

/**
 * Get category spending breakdown sorted by highest amount
 */
export function getCategoryBreakdown(
  yearMonth: string,
  transactions: Transaction[],
  categories: Record<string, { name: string; color: string; icon: string; type: Transaction['type'] }>,
  options: { variableOnly?: boolean; monthStartDay?: number } = {},
) {
  const period = getAccountingPeriod(yearMonth, options.monthStartDay ?? 1);
  const expenses = transactions.filter(
    t => t.type === 'expense'
      && isDateInPeriod(t.localDate, period)
      && (!options.variableOnly || !t.recurringTemplateId)
  );
  
  const map: Record<string, number> = {};
  let total = 0;
  
  for (const t of expenses) {
    const categoryId = categories[t.categoryId]?.type === 'expense' ? t.categoryId : '__needs_review_expense';
    map[categoryId] = (map[categoryId] || 0) + t.amount;
    total += t.amount;
  }
  
  return Object.entries(map)
    .map(([catId, amount]) => {
      const catInfo = catId === '__needs_review_expense'
        ? { name: '분류 확인 필요', color: '#F59E0B', icon: 'AlertTriangle', type: 'expense' as const }
        : categories[catId] || { name: '기타', color: '#94A3B8', icon: 'MoreHorizontal', type: 'expense' as const };
      const percent = total > 0 ? Math.round((amount / total) * 100) : 0;
      return {
        categoryId: catId,
        categoryName: catInfo.name,
        color: catInfo.color,
        icon: catInfo.icon,
        amount,
        percent,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}
