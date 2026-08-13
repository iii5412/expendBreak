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

  /** Amounts to apply on a given date, signed: positive adds to the balance. */
  const movements = new Map<string, Array<{ label: string; amount: number }>>();
  const addMovement = (date: string, label: string, amount: number) => {
    if (!isDateInPeriod(date, period) || amount === 0) return;
    movements.set(date, [...(movements.get(date) || []), { label, amount }]);
  };

  // Recorded history. Card settlements are real withdrawals; card purchases are
  // not, since they leave the account only when the bill is paid.
  transactions.forEach(transaction => {
    const role = transaction.role ?? 'normal';
    if (transaction.type === 'income') {
      addMovement(transaction.localDate, transaction.merchant || '수입', Math.round(transaction.amount));
      return;
    }
    if (role === 'normal' && transaction.paymentMethodType === 'card') return;
    addMovement(transaction.localDate, transaction.merchant || '지출', -Math.round(transaction.amount));
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
  const [startYear, startMonth, startDay] = period.startDate.split('-').map(Number);
  let balance = startingBalance;
  let shortfallDate: string | null = null;
  let lowestBalance = startingBalance;

  for (let offset = 0; offset < period.daysInMonth; offset += 1) {
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
    hasStartingBalance: bankAccounts.some(account => Math.round(account.balance || 0) !== 0),
  };
}
