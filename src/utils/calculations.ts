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

/**
 * Calculate total days in a month and days remaining
 */
export function getMonthDaysInfo(yearMonth: string, now = new Date()) {
  const [yStr, mStr] = yearMonth.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  
  const lastDayObj = new Date(year, month, 0);
  const daysInMonth = lastDayObj.getDate();
  
  const currentYM = getYearMonthString(now);
  let daysPassed = 1;
  
  if (currentYM === yearMonth) {
    daysPassed = now.getDate();
  } else if (currentYM > yearMonth) {
    daysPassed = daysInMonth;
  } else {
    daysPassed = 0;
  }
  
  // Days remaining includes today
  const daysRemaining = Math.max(1, daysInMonth - daysPassed + 1);
  
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
  now = new Date()
): MonthSummary {
  const { daysInMonth, daysPassed, daysRemaining } = getMonthDaysInfo(yearMonth, now);
  const templateMap = new Map(templates.map(t => [t.id, t]));

  // Filter transactions for this YYYY-MM
  const monthTxs = transactions.filter(t => t.localDate.startsWith(yearMonth));

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
    o => o.scheduledDate.startsWith(yearMonth) && (o.status === 'scheduled' || o.status === 'needs_confirmation' || o.status === 'overdue')
  );

  // Scheduled Income (recurring items with template.type === 'income')
  const scheduledIncome = pendingOccurrences
    .filter(o => {
      const tmpl = templateMap.get(o.templateId);
      return (o.typeSnapshot ?? tmpl?.type) === 'income';
    })
    .reduce((sum, o) => sum + Math.round(o.actualAmount ?? o.expectedAmount), 0);

  // Remaining Scheduled Expenses (recurring items with template.type === 'expense' or fallback)
  const remainingScheduledExpenses = pendingOccurrences
    .filter(o => {
      const tmpl = templateMap.get(o.templateId);
      return (o.typeSnapshot ?? tmpl?.type) === 'expense';
    })
    .reduce((sum, o) => sum + Math.round(o.actualAmount ?? o.expectedAmount), 0);

  const totalIncome = confirmedIncome + scheduledIncome;
  const totalExpectedRecurringIncome = confirmedRecurringIncome + scheduledIncome;
  const totalExpectedFixedExpenses = confirmedFixedExpenses + remainingScheduledExpenses;
  
  // Cash flows
  const netCashFlow = confirmedIncome - confirmedExpenses;
  
  // Allowance control. Keep Budget.totalLimit persisted as-is and reinterpret it as
  // the user-controlled allowance limit so existing records require no migration.
  const allowanceLimit = Math.round(budget.totalLimit);
  const remainingAllowance = allowanceLimit - confirmedVariableExpenses;
  const disposableAfterFixed = totalIncome - totalExpectedFixedExpenses;
  const plannedSavings = disposableAfterFixed - allowanceLimit;
  const allowanceOverCapacity = Math.max(0, -plannedSavings);

  // Backward-compatible aliases for existing API/AI consumers.
  const monthlyBudgetLimit = allowanceLimit;
  const simpleRemainingLimit = remainingAllowance;
  const safetyBalance = remainingAllowance;
  
  // Daily Safe Spending Allowance: max(0, floor(remainingAllowance / daysRemaining))
  const dailySafeAllowance = Math.max(0, Math.floor(remainingAllowance / Math.max(1, daysRemaining)));
  
  // Allowance Usage %
  const budgetUsagePercent = allowanceLimit > 0
    ? Math.min(999, Math.round((confirmedVariableExpenses / allowanceLimit) * 100))
    : 0;
    
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
    const endDay = Math.min(daysInMonth, daysPassed);
    const startDay = Math.max(1, endDay - 13);
    const recentStart = `${yearMonth}-${String(startDay).padStart(2, '0')}`;
    const recentEnd = `${yearMonth}-${String(endDay).padStart(2, '0')}`;
    const recentVariableSpend = variableTxs
      .filter(transaction => transaction.localDate >= recentStart && transaction.localDate <= recentEnd)
      .reduce((sum, transaction) => sum + Math.round(transaction.amount), 0);
    const observedDays = endDay - startDay + 1;
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
  options: { variableOnly?: boolean } = {},
) {
  const expenses = transactions.filter(
    t => t.type === 'expense'
      && t.localDate.startsWith(yearMonth)
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
