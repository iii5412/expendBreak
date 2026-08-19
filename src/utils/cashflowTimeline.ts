import { BankAccount, RecurringOccurrence, RecurringTemplate, Transaction } from '../types';
import { AccountingPeriod, getLocalDateString, isDateInPeriod } from './calculations';
import { MonthlyCardSettlementSummary } from './cardPayments';

/**
 * Day-by-day account balance across the cycle: known inflows and outflows on
 * their dates, plus the current spending trend carried forward.
 *
 * The point is to reveal a dip before it happens — a card bill on the 25th can
 * overdraw an account that looks comfortable on the 12th, and no other screen
 * puts the dates and the balance together.
 */

export interface CashflowTimelinePoint {
  date: string;
  balance: number;
  /** True once the point is a projection rather than recorded history. */
  projected: boolean;
  /** Labelled events landing on this date, for annotation. */
  events: Array<{ label: string; amount: number }>;
}

export interface CashflowTimeline {
  points: CashflowTimelinePoint[];
  /** First date the balance goes negative, or null when it never does. */
  shortfallDate: string | null;
  lowestBalance: number;
  /** False when no account balance is recorded, making the whole line meaningless. */
  hasStartingBalance: boolean;
  /** Snapshot date used as the opening point. Transactions on/before it are already in the balance. */
  balanceAsOfDate: string | null;
}

export function buildCashflowTimeline(
  period: AccountingPeriod,
  transactions: Transaction[],
  occurrences: RecurringOccurrence[],
  templates: RecurringTemplate[],
  bankAccounts: BankAccount[],
  cardSettlement: MonthlyCardSettlementSummary,
  dailySpendRate: number,
  now = new Date(),
): CashflowTimeline {
  const startingBalance = bankAccounts.reduce((sum, account) => sum + Math.round(account.balance || 0), 0);
  const templateMap = new Map(templates.map(template => [template.id, template]));
  const today = getLocalDateString(now);
  const recordedBalanceDates = bankAccounts
    .map(account => account.balanceAsOf)
    .filter((date): date is string => Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date)))
    .sort();
  const balanceAsOfDate = recordedBalanceDates.at(-1) ?? null;
  const snapshotFallsAfterPeriod = Boolean(balanceAsOfDate && balanceAsOfDate > period.endDate);
  const timelineStartDate = balanceAsOfDate && balanceAsOfDate > period.startDate
    ? balanceAsOfDate
    : period.startDate;
  const signedRecordedMovement = (transaction: Transaction) => {
    const role = transaction.role ?? 'normal';
    if (role === 'transfer') return 0;
    if (transaction.type === 'income') return Math.round(transaction.amount);
    if (role === 'normal' && transaction.paymentMethodType === 'card') return 0;
    return -Math.round(transaction.amount);
  };
  const openingBalanceAdjustment = balanceAsOfDate && balanceAsOfDate < period.startDate
    ? transactions
      .filter(transaction => transaction.localDate > balanceAsOfDate && transaction.localDate < period.startDate)
      .reduce((sum, transaction) => sum + signedRecordedMovement(transaction), 0)
    : 0;
  const balanceDateAlignment = balanceAsOfDate
    ? bankAccounts.reduce((sum, account) => {
      if (!account.balanceAsOf || account.balanceAsOf >= balanceAsOfDate) return sum;
      return sum + transactions
        .filter(transaction => transaction.accountId === account.id
          && transaction.localDate > account.balanceAsOf!
          && transaction.localDate <= balanceAsOfDate)
        .reduce((accountSum, transaction) => accountSum + signedRecordedMovement(transaction), 0);
    }, 0)
    : 0;

  /** Amounts to apply on a given date, signed: positive adds to the balance. */
  const movements = new Map<string, Array<{ label: string; amount: number }>>();
  const addMovement = (date: string, label: string, amount: number) => {
    if (!isDateInPeriod(date, period) || amount === 0) return;
    // The manually entered balance already contains everything through its
    // snapshot date. Replaying those rows was the source of double deductions.
    if (balanceAsOfDate && date <= balanceAsOfDate) return;
    movements.set(date, [...(movements.get(date) || []), { label, amount }]);
  };

  // Recorded history. Card settlements are real withdrawals; card purchases are
  // not, since they leave the account only when the bill is paid.
  transactions.forEach(transaction => {
    const amount = signedRecordedMovement(transaction);
    if (amount === 0) return;
    addMovement(transaction.localDate, transaction.merchant || (amount > 0 ? '수입' : '지출'), amount);
  });

  // Still-pending recurring items, on their scheduled dates.
  occurrences.forEach(occurrence => {
    if (occurrence.status === 'posted' || occurrence.status === 'skipped') return;
    const template = templateMap.get(occurrence.templateId);
    const type = occurrence.typeSnapshot ?? template?.type ?? 'expense';
    const method = occurrence.paymentMethodType ?? template?.paymentMethodType;
    if (type === 'expense' && method === 'card') return; // settled through the bill
    const amount = Math.round(occurrence.actualAmount ?? occurrence.expectedAmount);
    addMovement(occurrence.scheduledDate, template?.name || '정기 항목', type === 'income' ? amount : -amount);
  });

  // Card bills that have not been paid yet.
  cardSettlement.cards.forEach(card => {
    if (card.status === 'paid' || !card.paymentDate || card.amount <= 0) return;
    addMovement(card.paymentDate, `${card.cardName} 카드대금`, -card.amount);
  });

  const points: CashflowTimelinePoint[] = [];
  const [startYear, startMonth, startDay] = timelineStartDate.split('-').map(Number);
  const endDate = new Date(`${period.endDate}T12:00:00`);
  const startDate = new Date(startYear, startMonth - 1, startDay, 12);
  const timelineDays = snapshotFallsAfterPeriod
    ? 0
    : Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
  let balance = startingBalance + balanceDateAlignment + openingBalanceAdjustment;
  let shortfallDate: string | null = null;
  let lowestBalance = balance;

  for (let offset = 0; offset < timelineDays; offset += 1) {
    const date = getLocalDateString(new Date(startYear, startMonth - 1, startDay + offset));
    const events = movements.get(date) || [];
    balance += events.reduce((sum, event) => sum + event.amount, 0);

    // Past days already carry their real spending; only the future needs the trend.
    const projected = date > today;
    if (projected && dailySpendRate > 0) balance -= Math.round(dailySpendRate);

    if (balance < lowestBalance) lowestBalance = balance;
    if (balance < 0 && !shortfallDate) shortfallDate = date;

    points.push({ date, balance, projected, events });
  }

  return {
    points,
    shortfallDate,
    lowestBalance,
    hasStartingBalance: !snapshotFallsAfterPeriod
      && bankAccounts.some(account => Math.round(account.balance || 0) !== 0),
    balanceAsOfDate,
  };
}
