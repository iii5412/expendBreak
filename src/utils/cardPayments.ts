import { PaymentCard, RecurringOccurrence, RecurringTemplate, Transaction } from '../types';
import { getAccountingPeriod, getLocalDateString, getMonthlyDueDateInPeriod, isDateInPeriod, shiftYearMonth } from './calculations';
import { getInstallmentCharge } from './installments';

export interface CreditCardPaymentEstimate {
  cardId: string;
  cardName: string;
  cardCompany: string;
  billingDay: number | null;
  linkedAccountId: string | null;
  totalAmount: number;
  allowanceAmount: number;
  fixedAmount: number;
  scheduledFixedAmount: number;
  installmentAmount: number;
  installments: Array<{
    transactionId: string;
    merchant: string;
    round: number;
    totalMonths: number;
    amount: number;
  }>;
  estimatedPaymentDate: string | null;
}

export interface CardPaymentSummary {
  yearMonth: string;
  totalCardUsage: number;
  creditCardUsage: number;
  debitCardUsage: number;
  unassignedCardUsage: number;
  scheduledFixedCardUsage: number;
  estimatedNextPaymentTotal: number;
  creditCards: CreditCardPaymentEstimate[];
}

export interface MonthlyCardSettlement {
  cardId: string;
  cardName: string;
  cardCompany: string;
  linkedAccountId: string | null;
  paymentDate: string | null;
  /** Calendar month of the card usage this bill charges. */
  usageYearMonth: string;
  usageStartDate: string;
  usageEndDate: string;
  /** False when the window is the calendar-month fallback, i.e. an estimate. */
  hasStatementWindow: boolean;
  amount: number;
  estimatedAmount: number;
  source: 'confirmed' | 'estimated';
  status: 'scheduled' | 'paid';
}

export interface MonthlyCardSettlementSummary {
  yearMonth: string;
  totalAmount: number;
  linkedAccountTotal: number;
  unlinkedAmount: number;
  cards: MonthlyCardSettlement[];
}

export interface MonthlyCardSettlementOptions {
  /**
   * Attribute all usage from the previous calendar month to this payment month.
   * Used by month-labelled projections where August 1~31 must appear in the
   * September card bill regardless of payday or statement-closing dates.
   */
  usageBasis?: 'statement_window' | 'previous_calendar_month';
}

function getEstimatedPaymentDate(yearMonth: string, billingDay?: number | null): string | null {
  if (!billingDay) return null;
  const [yearText, monthText] = yearMonth.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;

  // JavaScript months are zero-based, so the 1-based current month points to next month here.
  const nextMonthStart = new Date(year, month, 1);
  const lastDay = new Date(nextMonthStart.getFullYear(), nextMonthStart.getMonth() + 1, 0).getDate();
  const normalizedDay = Math.min(Math.max(1, Math.round(billingDay)), lastDay);
  const paymentDate = new Date(nextMonthStart.getFullYear(), nextMonthStart.getMonth(), normalizedDay);

  return [
    paymentDate.getFullYear(),
    String(paymentDate.getMonth() + 1).padStart(2, '0'),
    String(paymentDate.getDate()).padStart(2, '0'),
  ].join('-');
}

function getPreviousYearMonth(yearMonth: string): string {
  const [yearText, monthText] = yearMonth.split('-');
  const date = new Date(Number(yearText), Number(monthText) - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export interface CardSettlementSchedule {
  /** Withdrawal date, or null when the card has no billing day configured. */
  paymentDate: string | null;
  /** Calendar month whose card usage this bill charges. Anchors installment rounds. */
  usageYearMonth: string;
  /** Inclusive start of the usage this bill covers. */
  usageStartDate: string;
  /** Inclusive end of the usage this bill covers. */
  usageEndDate: string;
  /** True when the window comes from a real statement closing day, not the fallback. */
  hasStatementWindow: boolean;
}

const addDays = (localDate: string, days: number) => {
  const [year, month, day] = localDate.split('-').map(Number);
  return getLocalDateString(new Date(year, month - 1, day + days));
};

/** `dayOfMonth` inside `yearMonth`, clamped to months that are shorter. */
function dateInMonth(yearMonth: string, dayOfMonth: number): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(lastDay, Math.max(1, Math.trunc(dayOfMonth)));
  return `${yearMonth}-${String(day).padStart(2, '0')}`;
}

/**
 * Which bill of a card lands in the given payday cycle.
 *
 * The bill belongs to the cycle that contains its payment date (INV-3), not to
 * a calendar month. With a salary day of 10 and a billing day of 5, the bill
 * withdrawn on 9/5 belongs to the 8/10~9/9 cycle and charges August usage —
 * the calendar-month shortcut used to attribute it to the wrong cycle entirely.
 *
 * With `statementClosingDay` set, the window is the real one the issuer bills:
 * Shinhan's 25th payment closes on the 11th, so the August bill covers 7/12~8/11.
 * Without it, the calendar month before the payment month is the best guess and
 * `hasStatementWindow` is false so the UI can label the figure as an estimate.
 */
export function getCardSettlementSchedule(
  paymentYearMonth: string,
  billingDay: number | null | undefined,
  monthStartDay: number = 1,
  statementClosingDay?: number | null,
): CardSettlementSchedule {
  const period = getAccountingPeriod(paymentYearMonth, monthStartDay);
  const paymentDate = billingDay ? getMonthlyDueDateInPeriod(billingDay, period) : null;
  // Without a payment date the cycle's own starting month is the best anchor.
  const paymentMonth = paymentDate ? paymentDate.slice(0, 7) : period.startDate.slice(0, 7);

  if (!statementClosingDay || !paymentDate) {
    const usageYearMonth = getPreviousYearMonth(paymentMonth);
    const [year, month] = usageYearMonth.split('-').map(Number);
    return {
      paymentDate,
      usageYearMonth,
      usageStartDate: `${usageYearMonth}-01`,
      usageEndDate: `${usageYearMonth}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`,
      hasStatementWindow: false,
    };
  }

  // The window ends at the most recent closing date strictly before payment, so
  // a closing day later in the month than the billing day still resolves.
  let usageEndDate = dateInMonth(paymentMonth, statementClosingDay);
  if (usageEndDate >= paymentDate) {
    usageEndDate = dateInMonth(getPreviousYearMonth(paymentMonth), statementClosingDay);
  }
  const usageStartDate = addDays(
    dateInMonth(getPreviousYearMonth(usageEndDate.slice(0, 7)), statementClosingDay),
    1,
  );

  return {
    paymentDate,
    // Installment rounds are keyed by month; the closing month is the round this
    // statement bills.
    usageYearMonth: usageEndDate.slice(0, 7),
    usageStartDate,
    usageEndDate,
    hasStatementWindow: true,
  };
}

/** Explicit date range to bill, overriding the accounting-period default. */
export interface CardUsageWindow {
  startDate: string;
  endDate: string;
}

export function calculateCardPaymentSummary(
  yearMonth: string,
  transactions: Transaction[],
  paymentCards: PaymentCard[],
  monthStartDay: number = 1,
  recurringOccurrences: RecurringOccurrence[] = [],
  recurringTemplates: RecurringTemplate[] = [],
  usageWindow?: CardUsageWindow,
): CardPaymentSummary {
  // A real statement window rarely aligns to any month, so callers that know it
  // pass the dates and `yearMonth` stays the installment-round anchor only.
  const period = usageWindow
    ? { ...getAccountingPeriod(yearMonth, monthStartDay), startDate: usageWindow.startDate, endDate: usageWindow.endDate }
    : getAccountingPeriod(yearMonth, monthStartDay);
  const cardMap = new Map(paymentCards.map(card => [card.id, card]));
  const creditCards = new Map<string, CreditCardPaymentEstimate>();

  paymentCards
    .filter(card => card.cardType === 'credit')
    .forEach(card => {
      creditCards.set(card.id, {
        cardId: card.id,
        cardName: card.cardName,
        cardCompany: card.cardCompany,
        billingDay: card.billingDay ?? null,
        linkedAccountId: card.linkedAccountId ?? null,
        totalAmount: 0,
        allowanceAmount: 0,
        fixedAmount: 0,
        scheduledFixedAmount: 0,
        installmentAmount: 0,
        installments: [],
        estimatedPaymentDate: getEstimatedPaymentDate(yearMonth, card.billingDay),
      });
    });

  let totalCardUsage = 0;
  let debitCardUsage = 0;
  let unassignedCardUsage = 0;
  let scheduledFixedCardUsage = 0;

  transactions
    .filter(transaction => transaction.type === 'expense'
      && transaction.paymentMethodType === 'card'
      // Paying the bill is not card usage; it would otherwise re-bill itself.
      && (transaction.role ?? 'normal') === 'normal')
    .forEach(transaction => {
      const installmentCharge = getInstallmentCharge(transaction.amount, transaction.installment, yearMonth);
      if (transaction.installment) {
        if (!installmentCharge) return;
      } else if (!isDateInPeriod(transaction.localDate, period)) {
        return;
      }
      const amount = installmentCharge?.amount ?? Math.round(transaction.amount);
      totalCardUsage += amount;
      const card = transaction.cardId ? cardMap.get(transaction.cardId) : undefined;

      if (!card) {
        unassignedCardUsage += amount;
        return;
      }
      if (card.cardType === 'debit') {
        debitCardUsage += amount;
        return;
      }

      const estimate = creditCards.get(card.id);
      if (!estimate) return;
      estimate.totalAmount += amount;
      if (installmentCharge && transaction.installment) {
        estimate.installmentAmount += amount;
        estimate.installments.push({
          transactionId: transaction.id,
          merchant: transaction.merchant,
          round: installmentCharge.round,
          totalMonths: transaction.installment.totalMonths,
          amount,
        });
      }
      if (transaction.recurringTemplateId) estimate.fixedAmount += amount;
      else estimate.allowanceAmount += amount;
    });

  // Fixed expenses paid by card belong to that card's bill even before the
  // occurrence is posted. Posted occurrences are already represented by their
  // transaction above and must not be counted twice.
  const templateMap = new Map(recurringTemplates.map(template => [template.id, template]));
  recurringOccurrences
    .filter(occurrence => isDateInPeriod(occurrence.scheduledDate, period)
      && occurrence.status !== 'posted'
      && occurrence.status !== 'skipped')
    .forEach(occurrence => {
      const template = templateMap.get(occurrence.templateId);
      if ((occurrence.typeSnapshot ?? template?.type) !== 'expense') return;
      const paymentMethodType = occurrence.paymentMethodType ?? template?.paymentMethodType;
      if (paymentMethodType !== 'card') return;

      const amount = Math.round(occurrence.actualAmount ?? occurrence.expectedAmount);
      const cardId = occurrence.cardId ?? template?.cardId;
      const card = cardId ? cardMap.get(cardId) : undefined;
      scheduledFixedCardUsage += amount;
      totalCardUsage += amount;
      if (!card) {
        unassignedCardUsage += amount;
        return;
      }
      if (card.cardType === 'debit') {
        debitCardUsage += amount;
        return;
      }
      const estimate = creditCards.get(card.id);
      if (!estimate) return;
      estimate.totalAmount += amount;
      estimate.fixedAmount += amount;
      estimate.scheduledFixedAmount += amount;
    });

  const estimates = [...creditCards.values()].sort((left, right) => right.totalAmount - left.totalAmount);
  const creditCardUsage = estimates.reduce((sum, card) => sum + card.totalAmount, 0);

  return {
    yearMonth,
    totalCardUsage,
    creditCardUsage,
    debitCardUsage,
    unassignedCardUsage,
    scheduledFixedCardUsage,
    estimatedNextPaymentTotal: creditCardUsage,
    creditCards: estimates,
  };
}

export interface CardSettlementAccuracy {
  /** Cycles compared, newest first. */
  samples: Array<{ yearMonth: string; estimated: number; confirmed: number }>;
  /** Mean absolute error as a percentage of the confirmed amount. */
  averageErrorPercent: number;
}

/**
 * How close recent estimates landed to the amounts the user actually confirmed.
 *
 * The bill is a projection built on assumptions the app cannot verify, so it
 * should say how much to trust it rather than presenting one number flatly.
 */
export function calculateCardSettlementAccuracy(
  card: PaymentCard,
  transactions: Transaction[],
  currentYearMonth: string,
  monthStartDay: number = 1,
  lookbackCycles: number = 6,
): CardSettlementAccuracy {
  const samples: CardSettlementAccuracy['samples'] = [];

  for (let offset = 1; offset <= lookbackCycles; offset += 1) {
    const yearMonth = shiftYearMonth(currentYearMonth, -offset);
    const confirmed = card.monthlyPaymentAmounts?.[yearMonth];
    if (!Number.isFinite(confirmed) || Number(confirmed) <= 0) continue;

    const schedule = getCardSettlementSchedule(
      yearMonth, card.billingDay, monthStartDay, card.statementClosingDay,
    );
    const estimate = calculateCardPaymentSummary(
      schedule.usageYearMonth, transactions, [card], 1, [], [],
      { startDate: schedule.usageStartDate, endDate: schedule.usageEndDate },
    ).creditCards.find(candidate => candidate.cardId === card.id);

    samples.push({
      yearMonth,
      estimated: Math.round(estimate?.totalAmount || 0),
      confirmed: Math.round(Number(confirmed)),
    });
  }

  const averageErrorPercent = samples.length === 0
    ? 0
    : Math.round(
      samples.reduce(
        (sum, sample) => sum + Math.abs(sample.estimated - sample.confirmed) / sample.confirmed,
        0,
      ) / samples.length * 100,
    );

  return { samples, averageErrorPercent };
}

/**
 * Card settlement is an account cash outflow, not a second expense.
 * When a cycle has no confirmed amount, the charged month's card usage is used.
 *
 * A bill belongs to the payday cycle containing its payment date (INV-3), so
 * cards with different billing days can charge different usage months within
 * the same cycle. Each distinct usage month is computed once and shared.
 */
export function calculateMonthlyCardSettlementSummary(
  paymentYearMonth: string,
  transactions: Transaction[],
  paymentCards: PaymentCard[],
  monthStartDay: number = 1,
  recurringOccurrences: RecurringOccurrence[] = [],
  recurringTemplates: RecurringTemplate[] = [],
  options: MonthlyCardSettlementOptions = {},
): MonthlyCardSettlementSummary {
  // Cards can close on different days, so each distinct window is computed once.
  const usageSummaries = new Map<string, CardPaymentSummary>();
  const getUsageSummary = (schedule: CardSettlementSchedule) => {
    const key = `${schedule.usageYearMonth}|${schedule.usageStartDate}|${schedule.usageEndDate}`;
    const cached = usageSummaries.get(key);
    if (cached) return cached;
    const summary = calculateCardPaymentSummary(
      schedule.usageYearMonth,
      transactions,
      paymentCards,
      1,
      recurringOccurrences,
      recurringTemplates,
      { startDate: schedule.usageStartDate, endDate: schedule.usageEndDate },
    );
    usageSummaries.set(key, summary);
    return summary;
  };

  const cards = paymentCards
    .filter(card => card.cardType === 'credit')
    .map(card => {
      const usePreviousCalendarMonth = options.usageBasis === 'previous_calendar_month';
      const schedule = getCardSettlementSchedule(
        paymentYearMonth,
        card.billingDay,
        usePreviousCalendarMonth ? 1 : monthStartDay,
        usePreviousCalendarMonth ? null : card.statementClosingDay,
      );
      const estimate = getUsageSummary(schedule)
        .creditCards.find(candidate => candidate.cardId === card.id);
      const confirmedAmount = card.monthlyPaymentAmounts?.[paymentYearMonth];
      const hasConfirmedAmount = Number.isFinite(confirmedAmount) && Number(confirmedAmount) >= 0;
      const estimatedAmount = Math.round(estimate?.totalAmount || 0);
      const amount = hasConfirmedAmount ? Math.round(Number(confirmedAmount)) : estimatedAmount;

      return {
        cardId: card.id,
        cardName: card.cardName,
        cardCompany: card.cardCompany,
        linkedAccountId: card.linkedAccountId ?? null,
        paymentDate: schedule.paymentDate,
        usageYearMonth: schedule.usageYearMonth,
        usageStartDate: schedule.usageStartDate,
        usageEndDate: schedule.usageEndDate,
        hasStatementWindow: schedule.hasStatementWindow,
        amount,
        estimatedAmount,
        source: hasConfirmedAmount ? 'confirmed' as const : 'estimated' as const,
        status: card.monthlyPaymentStatuses?.[paymentYearMonth] === 'paid' ? 'paid' as const : 'scheduled' as const,
      };
    })
    .sort((left, right) => right.amount - left.amount);

  const totalAmount = cards.reduce((sum, card) => sum + card.amount, 0);
  const linkedAccountTotal = cards
    .filter(card => card.linkedAccountId)
    .reduce((sum, card) => sum + card.amount, 0);

  return {
    yearMonth: paymentYearMonth,
    totalAmount,
    linkedAccountTotal,
    unlinkedAmount: totalAmount - linkedAccountTotal,
    cards,
  };
}
