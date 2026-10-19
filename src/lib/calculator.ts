import type {
  BudgetCalculation, BudgetCalculationInput, BudgetPeriodKey, LocalDate,
} from '../types/budget';

const DAY_MS = 86_400_000;

function dateValue(date: LocalDate): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) {
    throw new Error('유효하지 않은 날짜입니다.');
  }
  return value;
}

function localDate(value: number): LocalDate {
  return new Date(value).toISOString().slice(0, 10);
}

function validateStartDay(day: number) {
  if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error('주기 시작일은 1~28일이어야 합니다.');
}

/** Floor each input before addition; reject invalid values instead of hiding corrupt data. */
export function floorKrw(amount: number): number {
  const value = Math.floor(amount);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(value)) {
    throw new Error('금액은 안전한 범위의 0원 이상 숫자여야 합니다.');
  }
  return value;
}

function sum(amounts: readonly number[]): number {
  const total = amounts.reduce((result, amount) => result + floorKrw(amount), 0);
  if (!Number.isSafeInteger(total)) throw new Error('금액 합계가 안전한 정수 범위를 초과했습니다.');
  return total;
}

/** Supply the nominal scheduled date for early salary deposits, not their bank posting date. */
export function getBudgetPeriodKey(date: LocalDate, monthStartDay: number): BudgetPeriodKey {
  validateStartDay(monthStartDay);
  const calendar = new Date(dateValue(date));
  const previousMonth = calendar.getUTCDate() < monthStartDay;
  calendar.setUTCDate(1);
  if (previousMonth) calendar.setUTCMonth(calendar.getUTCMonth() - 1);
  return calendar.toISOString().slice(0, 7);
}

export function getBudgetPeriod(date: LocalDate, monthStartDay: number) {
  const key = getBudgetPeriodKey(date, monthStartDay);
  const start = `${key}-${String(monthStartDay).padStart(2, '0')}`;
  const next = new Date(dateValue(start));
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { key, start, end: localDate(next.getTime() - DAY_MS) };
}

export function calculateBudget(input: BudgetCalculationInput): BudgetCalculation {
  const { today, observationStartDate, settings, transactions, templates, occurrences } = input;
  const todayValue = dateValue(today);
  const observationStart = dateValue(observationStartDate);
  if (observationStart > todayValue) throw new Error('관측 시작일은 오늘 이후일 수 없습니다.');
  const period = input.period ?? getBudgetPeriod(today, settings.monthStartDay);
  if (dateValue(period.start) > todayValue || dateValue(period.end) < todayValue) {
    throw new Error('예산 주기에 오늘이 포함되어야 합니다.');
  }
  const remainingDays = Math.floor((dateValue(period.end) - todayValue) / DAY_MS) + 1;
  const limit = floorKrw(settings.variableExpenseLimit);
  for (const record of [...transactions, ...occurrences]) {
    dateValue(record.localDate);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(record.budgetPeriodKey)) throw new Error('예산 주기 키가 올바르지 않습니다.');
    floorKrw(record.amount);
  }
  const actual = transactions.filter(t => t.budgetPeriodKey === period.key && t.localDate <= today && t.type === 'expense');
  const variable = actual.filter(t => t.expenseNature === 'variable');
  // Overdue pending items remain reserved until explicitly posted or skipped.
  const pending = occurrences.filter(o => o.budgetPeriodKey === period.key && o.type === 'expense' && o.status === 'pending');
  const before = sum(variable.filter(t => t.localDate < today).map(t => t.amount));
  const spentToday = sum(variable.filter(t => t.localDate === today).map(t => t.amount));
  const pendingVariable = sum(pending.filter(o => o.expenseNature === 'variable').map(o => o.amount));
  const reserved = sum([before, pendingVariable]);
  const startBalance = limit - reserved;
  const currentBalance = limit - sum([reserved, spentToday]);
  const confirmedFixed = sum(actual.filter(t => t.expenseNature === 'fixed').map(t => t.amount));
  const pendingFixed = sum(pending.filter(o => o.expenseNature === 'fixed').map(o => o.amount));
  // Fixed one-off expenses already belong to confirmedFixed: do not add them again.
  const oneOff = sum(variable.filter(t => t.isOneOff).map(t => t.amount));
  const daily = sum(variable.filter(t => !t.isOneOff).map(t => t.amount));
  const windowStart = Math.max(observationStart, todayValue - 13 * DAY_MS);
  const observedDays = Math.floor((todayValue - windowStart) / DAY_MS) + 1;
  const recent = sum(transactions.filter(t => t.type === 'expense' && t.expenseNature === 'variable'
    && !t.isOneOff && t.localDate <= today && dateValue(t.localDate) >= windowStart).map(t => t.amount));
  const ready = observedDays >= 3;
  // Integer rational arithmetic preserves fractional daily speed until the final floor.
  const futureDaily = ready ? Number(BigInt(recent) * BigInt(remainingDays - 1) / BigInt(observedDays)) : 0;
  const allowance = Math.max(0, Math.floor(startBalance / Math.max(1, remainingDays)));
  return {
    budgetPeriodKey: period.key, periodStart: period.start, periodEnd: period.end,
    remainingDaysIncludingToday: remainingDays,
    fixedExpenseBudget: sum(templates.filter(t => t.active && t.type === 'expense' && t.expenseNature === 'fixed').map(t => t.amount)),
    variableExpenseLimit: limit, actualVariableBeforeToday: before, actualVariableToday: spentToday,
    pendingVariableExpense: pendingVariable, safeBalanceAtStartOfDay: startBalance,
    currentSafeBalance: currentBalance, todayAllowance: allowance, remainingToday: allowance - spentToday,
    projectedTomorrowAllowance: remainingDays >= 2 ? Math.max(0, Math.floor(currentBalance / (remainingDays - 1))) : null,
    confirmedFixedExpense: confirmedFixed, pendingFixedExpense: pendingFixed,
    accumulatedOneOffExpense: oneOff, accumulatedDailyVariableExpense: daily,
    burnRateObservationDays: observedDays, dailyBurnRate: ready ? Math.floor(recent / observedDays) : null,
    forecastStatus: ready ? 'ready' : 'insufficient_data',
    projectedPeriodEndExpense: ready ? sum([confirmedFixed, pendingFixed, oneOff, daily, futureDaily]) : null,
  };
}
