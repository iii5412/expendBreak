import {
  Transaction,
  RecurringOccurrence,
  RecurringTemplate,
  Budget,
  BudgetAlertLevel,
  CycleBaseline,
} from '../types';
import { getInstallmentCharge } from './installments';
import { getScheduledDatesForMonth } from './recurringNormalization';

/**
 * Two-track cash model. See `docs/PRD-payday-cashflow-model.md` §4.
 *
 * - Cash track answers "how much leaves the account this cycle": salary in,
 *   account transfers and the credit-card bill out. Settled on payday.
 * - Spend track answers "how much did I spend this cycle": variable spending
 *   at the moment it happens, regardless of payment method.
 *
 * Every amount belongs to exactly one track in exactly one cycle (INV-1/INV-2),
 * so a fixed expense charged to a card is deliberately absent from
 * {@link MonthSummary.accountFixedOutflow}: it exists only inside that card's
 * bill, which lands in the cycle containing its payment date.
 */
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
  /** Income the cash track plans on: confirmed deposits, or scheduled ones until they land. */
  planningIncome: number;
  /** True while the plan rests on income that has not been deposited yet. */
  isProjected: boolean;

  // Expenses
  confirmedExpenses: number;
  confirmedFixedExpenses: number;
  confirmedVariableExpenses: number;
  remainingScheduledExpenses: number;
  /** Inclusive window the living-expense spending is measured over (calendar month). */
  spendPeriodStartDate: string;
  spendPeriodEndDate: string;
  spendDaysInMonth: number;
  spendDaysPassed: number;
  /** Days left in the spending window, including today. Pairs with {@link dailySafeAllowance}. */
  spendDaysRemaining: number;

  // Cash track (INV-1)
  /** Recurring expenses transferred from an account. Card-paid ones are excluded. */
  accountFixedOutflow: number;
  confirmedAccountFixedOutflow: number;
  scheduledAccountFixedOutflow: number;
  /** Recurring expenses charged to a card. Reported for transparency only: they
   *  are already represented inside a future cycle's card bill. */
  cardFixedExpenses: number;
  /** Credit-card bills whose payment date falls inside this cycle. */
  cardSettlementOutflow: number;
  /** Amount the user sets aside before living expenses. */
  savingsReserve: number;
  /** Income - account transfers - card bills - savings. The one number that matters on payday. */
  livingBudget: number;
  remainingLivingBudget: number;
  /** True while {@link livingBudget} comes from a locked payday plan (INV-4). */
  isBaselineLocked: boolean;
  /** What the living budget would be if recomputed now. Equals {@link livingBudget} when unlocked. */
  recalculatedLivingBudget: number;
  /**
   * recalculatedLivingBudget - livingBudget. Non-zero means fixed amounts, the
   * card bill or income moved after the plan was locked. Surfaced instead of
   * being folded into the balance so the user decides whether to re-plan.
   */
  unplannedDelta: number;

  /** @deprecated Use {@link accountFixedOutflow} + {@link cardSettlementOutflow}. */
  totalExpectedFixedExpenses: number;

  // Cash Flow
  netCashFlow: number; // Confirmed Income - Confirmed Expenses
  expectedEndMonthCashFlow: number;

  // Budget Control
  /** Optional user cap on living expenses. 0 means no cap. */
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

  // Pace: is the money going out faster than the days are?
  /** Percent of the cycle elapsed, 0-100. */
  periodProgressPercent: number;
  /**
   * Date the living budget runs out at the current rate, or null when the pace
   * is unknown (< 3 days in) or the budget lasts past the cycle.
   */
  projectedDepletionDate: string | null;
  /** Days short when the budget runs out early; 0 when it lasts. */
  projectedShortfallDays: number;
  /** Daily amount that would make the budget last exactly to the end. */
  requiredDailyPace: number;
}

/** Cash-track inputs that live outside the transaction/occurrence stores. */
export interface MonthSummaryOptions {
  /** Credit-card bills due in this cycle, from `calculateMonthlyCardSettlementSummary`. */
  cardSettlementOutflow?: number;
  savingsReserve?: number;
  /** The cycle's locked payday plan, if the user has confirmed one. */
  baseline?: CycleBaseline | null;
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

/**
 * Every due date a template produces inside this period, holiday policy applied.
 *
 * The period can straddle two calendar months, and a weekly item recurs several
 * times within it, so both calendar months are walked and the results filtered
 * back down to the period.
 */
export function getScheduledDatesInPeriod(
  template: RecurringTemplate,
  period: AccountingPeriod,
): string[] {
  const calendarMonths = [...new Set([period.startDate.slice(0, 7), period.endDate.slice(0, 7)])];
  const dates = calendarMonths.flatMap(
    yearMonth => getScheduledDatesForMonth(template, yearMonth, period.monthStartDay),
  );
  // `getScheduledDatesForMonth` already applies the term, and it does so per
  // cycle. Re-filtering by raw date here would drop a first payment whose due
  // day precedes the day the item was registered inside the same cycle.
  return [...new Set(dates)]
    .filter(date => isDateInPeriod(date, period))
    .sort();
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
  options: MonthSummaryOptions = {},
): MonthSummary {
  const period = getAccountingPeriod(yearMonth, monthStartDay, now);
  const { daysInMonth, daysPassed, daysRemaining } = period;
  // The two tracks are bucketed differently on purpose. Cash (salary in, fixed
  // transfers and the card bill out) follows the payday cycle. Spending follows
  // the calendar month, because that is the window a card statement bills: money
  // spent on the 1st through the 9th is part of this month's usage, so it has to
  // count against this month's living budget rather than the previous cycle's.
  const spendPeriod = getAccountingPeriod(yearMonth, 1, now);
  const templateMap = new Map(templates.map(t => [t.id, t]));
  const cardSettlementOutflow = Math.max(0, Math.round(options.cardSettlementOutflow ?? 0));
  // A locked plan carries the reserve the user committed to; an explicit option
  // still wins so previews can show "what if I set aside more".
  const savingsReserve = Math.max(
    0,
    Math.round(options.savingsReserve ?? options.baseline?.savingsReserve ?? 0),
  );

  /** A recurring item paid by card belongs to that card's bill, never to the transfer list. */
  const isCardPaid = (
    item: { paymentMethodType?: Transaction['paymentMethodType'] },
    template?: RecurringTemplate,
  ) => (item.paymentMethodType ?? template?.paymentMethodType) === 'card';

  // Filter transactions inside this accounting period
  const monthTxs = transactions.filter(t => isDateInPeriod(t.localDate, period));

  // Confirmed Income
  const confirmedIncome = monthTxs
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + Math.round(t.amount), 0);

  const confirmedRecurringIncome = monthTxs
    .filter(t => t.type === 'income' && t.recurringTemplateId)
    .reduce((sum, t) => sum + Math.round(t.amount), 0);

  // Card settlements and transfers move money the app already accounts for, so
  // they are excluded from every expense total (INV-2). Only `normal` is spending.
  const isSpending = (transaction: Transaction) => (transaction.role ?? 'normal') === 'normal';

  // Confirmed Expenses
  const confirmedExpenses = monthTxs
    .filter(t => t.type === 'expense' && isSpending(t))
    .reduce((sum, t) => sum + Math.round(t.amount), 0);

  // Confirmed Fixed Expenses (expenses originating from recurring templates)
  const confirmedFixedTxs = monthTxs.filter(t => t.type === 'expense' && t.recurringTemplateId && isSpending(t));
  const confirmedFixedExpenses = confirmedFixedTxs
    .reduce((sum, t) => sum + Math.round(t.amount), 0);

  const confirmedAccountFixedOutflow = confirmedFixedTxs
    .filter(t => !isCardPaid(t, templateMap.get(t.recurringTemplateId as string)))
    .reduce((sum, t) => sum + Math.round(t.amount), 0);
  const confirmedCardFixedExpenses = confirmedFixedExpenses - confirmedAccountFixedOutflow;

  // Living-expense spending excludes anything already committed through a
  // recurring template. An installment purchase counts only the round due in this
  // cycle, matching how the card bill charges it (INV-5): a 12-month plan
  // otherwise wipes out a single cycle for a cost spread across a year. Rounds
  // are therefore collected from every installment purchase, not just this
  // cycle's, and an installment purchase is skipped in the cycle it was made.
  const variableTransactions = transactions.filter(transaction => {
    if (transaction.type !== 'expense' || transaction.recurringTemplateId) return false;
    if (!isSpending(transaction)) return false;
    return transaction.installment
      ? Boolean(getInstallmentCharge(transaction.amount, transaction.installment, yearMonth))
      : isDateInPeriod(transaction.localDate, spendPeriod);
  });
  const chargeFor = (transaction: Transaction) => transaction.installment
    ? getInstallmentCharge(transaction.amount, transaction.installment, yearMonth)?.amount ?? 0
    : Math.round(transaction.amount);
  const confirmedVariableExpenses = variableTransactions
    .reduce((sum, transaction) => sum + chargeFor(transaction), 0);

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
  const pendingExpenseOccurrences = pendingOccurrences.filter(o => {
    const tmpl = templateMap.get(o.templateId);
    return (o.typeSnapshot ?? tmpl?.type) === 'expense';
  });
  const scheduledOccurrenceExpenses = pendingExpenseOccurrences
    .reduce((sum, o) => sum + Math.round(o.actualAmount ?? o.expectedAmount), 0);
  const scheduledCardOccurrenceExpenses = pendingExpenseOccurrences
    .filter(o => isCardPaid(o, templateMap.get(o.templateId)))
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
  // Weekly items land several times per cycle, so the net counts occurrences,
  // not templates. Both frequencies honour the holiday policy: a due date pushed
  // across the period boundary belongs to the neighbouring cycle, not this one.
  const unmaterializedFixed = templates
    .filter(template => template.active
      && template.type === 'expense'
      && !occurrenceTemplateIds.has(template.id)
      && !transactionTemplateIds.has(template.id))
    .map(template => ({
      template,
      dueDates: getScheduledDatesInPeriod(template, period),
    }))
    .filter(entry => entry.dueDates.length > 0);
  const amountOf = (entry: { template: RecurringTemplate; dueDates: string[] }) =>
    Math.round(entry.template.defaultAmount) * entry.dueDates.length;
  const unmaterializedFixedExpenses = unmaterializedFixed.reduce((sum, entry) => sum + amountOf(entry), 0);
  const unmaterializedCardFixedExpenses = unmaterializedFixed
    .filter(entry => entry.template.paymentMethodType === 'card')
    .reduce((sum, entry) => sum + amountOf(entry), 0);
  const remainingScheduledExpenses = scheduledOccurrenceExpenses + unmaterializedFixedExpenses;

  // Reported income stays strictly what has arrived.
  const totalIncome = confirmedIncome;
  const totalExpectedRecurringIncome = confirmedRecurringIncome + scheduledIncome;

  // Planning, however, has to be symmetric: pending fixed expenses are already
  // reserved, so a pending salary must count too. Otherwise payday morning —
  // salary deposited but the occurrence not yet confirmed — reads as a large
  // overrun. The fallback is flagged so the UI can mark every derived figure
  // as provisional until the deposit is posted.
  const isProjected = confirmedIncome <= 0 && scheduledIncome > 0;
  const planningIncome = isProjected ? scheduledIncome : confirmedIncome;

  // Cash track. Card-paid recurring expenses drop out of the transfer list and
  // reappear only inside the card bill of the cycle that pays it (INV-1).
  const cardFixedExpenses = confirmedCardFixedExpenses
    + scheduledCardOccurrenceExpenses
    + unmaterializedCardFixedExpenses;
  const scheduledAccountFixedOutflow = remainingScheduledExpenses
    - scheduledCardOccurrenceExpenses
    - unmaterializedCardFixedExpenses;
  const accountFixedOutflow = confirmedAccountFixedOutflow + scheduledAccountFixedOutflow;

  // Retained for existing consumers, now meaning "everything to secure on payday":
  // account transfers plus the card bills due in this cycle.
  const totalExpectedFixedExpenses = accountFixedOutflow + cardSettlementOutflow;

  // Cash flows
  const netCashFlow = confirmedIncome - confirmedExpenses;

  const disposableAfterFixed = planningIncome - accountFixedOutflow - cardSettlementOutflow;
  const recalculatedLivingBudget = Math.max(0, disposableAfterFixed - savingsReserve);

  // A locked plan is what the user committed to on payday. Later edits to a
  // fixed amount or a card estimate must not move the remaining balance behind
  // their back, or the daily figure stops meaning "what I have left" (INV-4).
  const baseline = options.baseline ?? null;
  const isBaselineLocked = Boolean(baseline) && baseline?.yearMonth === yearMonth;
  const livingBudget = isBaselineLocked
    ? Math.max(0, Math.round((baseline as CycleBaseline).livingBudget))
    : recalculatedLivingBudget;
  const unplannedDelta = recalculatedLivingBudget - livingBudget;
  const remainingLivingBudget = livingBudget - confirmedVariableExpenses;

  // Allowance control. Keep Budget.totalLimit persisted as-is and reinterpret it as
  // an optional cap on living expenses; 0 means the user has not set one.
  const allowanceLimit = Math.max(0, Math.round(budget.totalLimit));
  const spendableLimit = allowanceLimit > 0 ? Math.min(allowanceLimit, livingBudget) : livingBudget;
  const remainingAllowance = spendableLimit - confirmedVariableExpenses;
  const plannedSavings = allowanceLimit > 0 ? livingBudget - allowanceLimit : savingsReserve;
  const allowanceOverCapacity = Math.max(0, -plannedSavings);

  // Backward-compatible aliases for existing API/AI consumers.
  const monthlyBudgetLimit = allowanceLimit;
  const simpleRemainingLimit = remainingAllowance;
  const safetyBalance = remainingAllowance;
  
  // Daily Safe Spending Allowance. Divided over the days left in the spending
  // window, since that is the window `remainingAllowance` is measured against.
  const dailySafeAllowance = Math.max(
    0,
    Math.floor(remainingAllowance / Math.max(1, spendPeriod.daysRemaining)),
  );
  
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
  
  // Forecast Month-End Spend based on recent 14 days variable spend average.
  // Installments are excluded: their rounds are already committed for the whole
  // cycle, so folding them into a daily rate would forecast them twice.
  const variableTxs = variableTransactions.filter(
    transaction => !transaction.installment && isDateInPeriod(transaction.localDate, spendPeriod),
  );
  let forecastMonthEndSpend: number | null = null;
  let forecastVariableSpend: number | null = null;
  let forecastAverageDailyVariable = 0;
  
  if (spendPeriod.daysPassed >= 3) {
    // Recent 14-day window, measured over the same calendar month the spending
    // itself is bucketed into.
    const endOffset = Math.min(spendPeriod.daysInMonth, spendPeriod.daysPassed);
    const startOffset = Math.max(1, endOffset - 13);
    const dayFromPeriodStart = (offset: number) => {
      const [year, month, day] = spendPeriod.startDate.split('-').map(Number);
      return getLocalDateString(new Date(year, month - 1, day + offset - 1));
    };
    const recentStart = dayFromPeriodStart(startOffset);
    const recentEnd = dayFromPeriodStart(endOffset);
    const recentVariableSpend = variableTxs
      .filter(transaction => transaction.localDate >= recentStart && transaction.localDate <= recentEnd)
      .reduce((sum, transaction) => sum + Math.round(transaction.amount), 0);
    const observedDays = endOffset - startOffset + 1;
    forecastAverageDailyVariable = Math.round(recentVariableSpend / observedDays);

    forecastVariableSpend = confirmedVariableExpenses
      + Math.round(forecastAverageDailyVariable * (spendPeriod.daysRemaining - 1));
    forecastMonthEndSpend = totalExpectedFixedExpenses + forecastVariableSpend;
  }
  
  // Pace. "Runs out on the 2nd, 7 days short" lands harder than a daily average,
  // and the required pace tells the user what to do about it.
  const periodProgressPercent = Math.min(
    100,
    Math.round((spendPeriod.daysPassed / spendPeriod.daysInMonth) * 100),
  );
  const requiredDailyPace = Math.max(
    0,
    Math.floor(remainingAllowance / Math.max(1, spendPeriod.daysRemaining)),
  );

  let projectedDepletionDate: string | null = null;
  let projectedShortfallDays = 0;
  if (spendPeriod.daysPassed >= 3 && forecastAverageDailyVariable > 0 && remainingAllowance > 0) {
    const daysUntilEmpty = Math.floor(remainingAllowance / forecastAverageDailyVariable);
    if (daysUntilEmpty < spendPeriod.daysRemaining - 1) {
      const [year, month, day] = spendPeriod.startDate.split('-').map(Number);
      projectedDepletionDate = getLocalDateString(
        new Date(year, month - 1, day + spendPeriod.daysPassed + daysUntilEmpty),
      );
      projectedShortfallDays = spendPeriod.daysRemaining - 1 - daysUntilEmpty;
    }
  } else if (spendPeriod.daysPassed >= 3 && remainingAllowance <= 0) {
    projectedDepletionDate = getLocalDateString(now);
    projectedShortfallDays = Math.max(0, spendPeriod.daysRemaining - 1);
  }

  const forecastSavings = forecastMonthEndSpend === null ? null : planningIncome - forecastMonthEndSpend;
  const expectedEndMonthCashFlow = forecastSavings ?? (planningIncome - totalExpectedFixedExpenses - confirmedVariableExpenses);

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
    planningIncome,
    isProjected,
    confirmedExpenses,
    confirmedFixedExpenses,
    confirmedVariableExpenses,
    remainingScheduledExpenses,
    spendPeriodStartDate: spendPeriod.startDate,
    spendPeriodEndDate: spendPeriod.endDate,
    spendDaysInMonth: spendPeriod.daysInMonth,
    spendDaysPassed: spendPeriod.daysPassed,
    spendDaysRemaining: spendPeriod.daysRemaining,
    accountFixedOutflow,
    confirmedAccountFixedOutflow,
    scheduledAccountFixedOutflow,
    cardFixedExpenses,
    cardSettlementOutflow,
    savingsReserve,
    livingBudget,
    remainingLivingBudget,
    isBaselineLocked,
    recalculatedLivingBudget,
    unplannedDelta,
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
    periodProgressPercent,
    projectedDepletionDate,
    projectedShortfallDays,
    requiredDailyPace,
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
  // Installments contribute their round for this period, matching the spend
  // track, so one big purchase does not dominate the category mix for a month.
  const expenses = transactions.filter(t => {
    if (t.type !== 'expense') return false;
    if (options.variableOnly && t.recurringTemplateId) return false;
    return t.installment
      ? Boolean(getInstallmentCharge(t.amount, t.installment, yearMonth))
      : isDateInPeriod(t.localDate, period);
  });

  const map: Record<string, number> = {};
  let total = 0;

  for (const t of expenses) {
    const categoryId = categories[t.categoryId]?.type === 'expense' ? t.categoryId : '__needs_review_expense';
    const amount = t.installment
      ? getInstallmentCharge(t.amount, t.installment, yearMonth)?.amount ?? 0
      : Math.round(t.amount);
    map[categoryId] = (map[categoryId] || 0) + amount;
    total += amount;
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
