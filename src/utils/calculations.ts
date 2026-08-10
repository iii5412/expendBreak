import { Transaction, RecurringOccurrence, RecurringTemplate, Budget, BudgetAlertLevel } from '../types';

export interface MonthSummary {
  yearMonth: string; // YYYY-MM
  daysInMonth: number;
  daysPassed: number;
  daysRemaining: number;
  
  // Income
  confirmedIncome: number;
  scheduledIncome: number;
  totalIncome: number;
  
  // Expenses
  confirmedExpenses: number;
  confirmedFixedExpenses: number;
  remainingScheduledExpenses: number;
  totalExpectedFixedExpenses: number;
  
  // Cash Flow
  netCashFlow: number; // Confirmed Income - Confirmed Expenses
  expectedEndMonthCashFlow: number;
  
  // Budget Control
  monthlyBudgetLimit: number;
  simpleRemainingLimit: number; // Budget Limit - Confirmed Expenses
  safetyBalance: number; // Budget Limit - Confirmed Expenses - Remaining Scheduled Expenses
  dailySafeAllowance: number; // max(0, Math.floor(Safety Balance / Days Remaining))
  
  // Progress & Status
  budgetUsagePercent: number;
  alertLevel: BudgetAlertLevel;
  
  // Month-end Forecast
  forecastMonthEndSpend: number | null; // null if insufficient data (< 3 days)
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

  // Confirmed Expenses
  const confirmedExpenses = monthTxs
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + Math.round(t.amount), 0);

  // Confirmed Fixed Expenses (expenses originating from recurring templates)
  const confirmedFixedExpenses = monthTxs
    .filter(t => t.type === 'expense' && t.recurringTemplateId)
    .reduce((sum, t) => sum + Math.round(t.amount), 0);

  // Filter pending occurrences for scheduled / needs_confirmation / overdue in this month
  const pendingOccurrences = occurrences.filter(
    o => o.scheduledDate.startsWith(yearMonth) && (o.status === 'scheduled' || o.status === 'needs_confirmation' || o.status === 'overdue')
  );

  // Scheduled Income (recurring items with template.type === 'income')
  const scheduledIncome = pendingOccurrences
    .filter(o => {
      const tmpl = templateMap.get(o.templateId);
      return tmpl?.type === 'income';
    })
    .reduce((sum, o) => sum + Math.round(o.actualAmount ?? o.expectedAmount), 0);

  // Remaining Scheduled Expenses (recurring items with template.type === 'expense' or fallback)
  const remainingScheduledExpenses = pendingOccurrences
    .filter(o => {
      const tmpl = templateMap.get(o.templateId);
      return tmpl ? tmpl.type === 'expense' : true;
    })
    .reduce((sum, o) => sum + Math.round(o.actualAmount ?? o.expectedAmount), 0);

  const totalIncome = confirmedIncome + scheduledIncome;
  const totalExpectedFixedExpenses = confirmedFixedExpenses + remainingScheduledExpenses;
  
  // Cash flows
  const netCashFlow = confirmedIncome - confirmedExpenses;
  
  // Budget Calculations
  const monthlyBudgetLimit = Math.round(budget.totalLimit);
  const simpleRemainingLimit = monthlyBudgetLimit - confirmedExpenses;
  const safetyBalance = monthlyBudgetLimit - confirmedExpenses - remainingScheduledExpenses;
  
  // Daily Safe Spending Allowance: max(0, floor(safetyBalance / daysRemaining))
  const dailySafeAllowance = Math.max(0, Math.floor(safetyBalance / Math.max(1, daysRemaining)));
  
  // Budget Usage %
  const budgetUsagePercent = monthlyBudgetLimit > 0
    ? Math.min(999, Math.round((confirmedExpenses / monthlyBudgetLimit) * 100))
    : 0;
    
  // Alert Level
  let alertLevel: BudgetAlertLevel = 'safe';
  if (budgetUsagePercent >= 100) {
    alertLevel = 'danger';
  } else if (budgetUsagePercent >= 85) {
    alertLevel = 'warning';
  } else if (budgetUsagePercent >= 70) {
    alertLevel = 'caution';
  }
  
  // Forecast Month-End Spend based on recent 14 days variable spend average
  // Variable spend = non-fixed expense transactions
  const variableTxs = monthTxs.filter(t => t.type === 'expense' && !t.recurringTemplateId);
  const variableSpendSum = variableTxs.reduce((sum, t) => sum + Math.round(t.amount), 0);
  
  let forecastMonthEndSpend: number | null = null;
  let forecastAverageDailyVariable = 0;
  
  if (daysPassed >= 3) {
    // Average daily variable spend over days passed (or max 14 days)
    const effectiveDaysForAvg = Math.min(14, daysPassed);
    forecastAverageDailyVariable = Math.round(variableSpendSum / daysPassed);
    
    // Month-End Forecast = Confirmed Expenses + Remaining Scheduled Expenses + (Daily Variable Avg * Days Remaining)
    forecastMonthEndSpend = confirmedExpenses + remainingScheduledExpenses + Math.round(forecastAverageDailyVariable * (daysRemaining - 1));
  }
  
  const expectedEndMonthCashFlow = totalIncome - (forecastMonthEndSpend ?? (confirmedExpenses + remainingScheduledExpenses));

  return {
    yearMonth,
    daysInMonth,
    daysPassed,
    daysRemaining,
    confirmedIncome,
    scheduledIncome,
    totalIncome,
    confirmedExpenses,
    confirmedFixedExpenses,
    remainingScheduledExpenses,
    totalExpectedFixedExpenses,
    netCashFlow,
    expectedEndMonthCashFlow,
    monthlyBudgetLimit,
    simpleRemainingLimit,
    safetyBalance,
    dailySafeAllowance,
    budgetUsagePercent,
    alertLevel,
    forecastMonthEndSpend,
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
  categories: Record<string, { name: string; color: string; icon: string }>
) {
  const expenses = transactions.filter(
    t => t.type === 'expense' && t.localDate.startsWith(yearMonth)
  );
  
  const map: Record<string, number> = {};
  let total = 0;
  
  for (const t of expenses) {
    map[t.categoryId] = (map[t.categoryId] || 0) + t.amount;
    total += t.amount;
  }
  
  return Object.entries(map)
    .map(([catId, amount]) => {
      const catInfo = categories[catId] || { name: '기타', color: '#94A3B8', icon: 'MoreHorizontal' };
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
