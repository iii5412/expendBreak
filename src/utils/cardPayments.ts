import { PaymentCard, Transaction } from '../types';
import { getAccountingPeriod, isDateInPeriod } from './calculations';

export interface CreditCardPaymentEstimate {
  cardId: string;
  cardName: string;
  cardCompany: string;
  billingDay: number | null;
  linkedAccountId: string | null;
  totalAmount: number;
  allowanceAmount: number;
  fixedAmount: number;
  estimatedPaymentDate: string | null;
}

export interface CardPaymentSummary {
  yearMonth: string;
  totalCardUsage: number;
  creditCardUsage: number;
  debitCardUsage: number;
  unassignedCardUsage: number;
  estimatedNextPaymentTotal: number;
  creditCards: CreditCardPaymentEstimate[];
}

export interface MonthlyCardSettlement {
  cardId: string;
  cardName: string;
  cardCompany: string;
  linkedAccountId: string | null;
  paymentDate: string | null;
  amount: number;
  estimatedAmount: number;
  source: 'confirmed' | 'estimated';
}

export interface MonthlyCardSettlementSummary {
  yearMonth: string;
  totalAmount: number;
  linkedAccountTotal: number;
  unlinkedAmount: number;
  cards: MonthlyCardSettlement[];
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

export function calculateCardPaymentSummary(
  yearMonth: string,
  transactions: Transaction[],
  paymentCards: PaymentCard[],
  monthStartDay: number = 1,
): CardPaymentSummary {
  const period = getAccountingPeriod(yearMonth, monthStartDay);
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
        estimatedPaymentDate: getEstimatedPaymentDate(yearMonth, card.billingDay),
      });
    });

  let totalCardUsage = 0;
  let debitCardUsage = 0;
  let unassignedCardUsage = 0;

  transactions
    .filter(transaction => transaction.type === 'expense'
      && transaction.paymentMethodType === 'card'
      && isDateInPeriod(transaction.localDate, period))
    .forEach(transaction => {
      const amount = Math.round(transaction.amount);
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
      if (transaction.recurringTemplateId) estimate.fixedAmount += amount;
      else estimate.allowanceAmount += amount;
    });

  const estimates = [...creditCards.values()].sort((left, right) => right.totalAmount - left.totalAmount);
  const creditCardUsage = estimates.reduce((sum, card) => sum + card.totalAmount, 0);

  return {
    yearMonth,
    totalCardUsage,
    creditCardUsage,
    debitCardUsage,
    unassignedCardUsage,
    estimatedNextPaymentTotal: creditCardUsage,
    creditCards: estimates,
  };
}

/**
 * Card settlement is an account cash outflow, not a second expense.
 * When a month has no confirmed amount, the previous calendar month's card usage is used.
 */
export function calculateMonthlyCardSettlementSummary(
  paymentYearMonth: string,
  transactions: Transaction[],
  paymentCards: PaymentCard[],
  monthStartDay: number = 1,
): MonthlyCardSettlementSummary {
  const previousMonthUsage = calculateCardPaymentSummary(
    getPreviousYearMonth(paymentYearMonth),
    transactions,
    paymentCards,
    monthStartDay,
  );
  const estimateMap = new Map(previousMonthUsage.creditCards.map(card => [card.cardId, card]));

  const cards = paymentCards
    .filter(card => card.cardType === 'credit')
    .map(card => {
      const estimate = estimateMap.get(card.id);
      const confirmedAmount = card.monthlyPaymentAmounts?.[paymentYearMonth];
      const hasConfirmedAmount = Number.isFinite(confirmedAmount) && Number(confirmedAmount) >= 0;
      const estimatedAmount = Math.round(estimate?.totalAmount || 0);
      const amount = hasConfirmedAmount ? Math.round(Number(confirmedAmount)) : estimatedAmount;

      return {
        cardId: card.id,
        cardName: card.cardName,
        cardCompany: card.cardCompany,
        linkedAccountId: card.linkedAccountId ?? null,
        paymentDate: estimate?.estimatedPaymentDate ?? null,
        amount,
        estimatedAmount,
        source: hasConfirmedAmount ? 'confirmed' as const : 'estimated' as const,
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
