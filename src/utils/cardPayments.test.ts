import { describe, expect, it } from 'vitest';
import { PaymentCard, RecurringOccurrence, RecurringTemplate, Transaction } from '../types';
import { calculateCardPaymentSummary, calculateMonthlyCardSettlementSummary } from './cardPayments';

const now = '2026-08-11T00:00:00.000Z';
const cards: PaymentCard[] = [
  {
    id: 'credit', cardName: '생활 신용카드', cardCompany: '신한카드', cardType: 'credit',
    linkedAccountId: 'account', billingDay: 31, createdAt: now, updatedAt: now,
  },
  {
    id: 'debit', cardName: '체크카드', cardCompany: '국민카드', cardType: 'debit',
    linkedAccountId: 'account', createdAt: now, updatedAt: now,
  },
];

const transaction = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx', type: 'expense', amount: 100_000, occurredAt: now, localDate: '2026-08-11',
  categoryId: 'food', merchant: '상점', memo: '', source: 'manual', paymentMethodType: 'card',
  createdAt: now, updatedAt: now, ...overrides,
});

describe('calculateMonthlyCardSettlementSummary', () => {
  it('uses previous-month usage as the account withdrawal estimate', () => {
    const summary = calculateMonthlyCardSettlementSummary('2026-09', [
      transaction({ cardId: 'credit', amount: 230_000 }),
    ], cards);

    expect(summary.totalAmount).toBe(230_000);
    expect(summary.linkedAccountTotal).toBe(230_000);
    expect(summary.cards[0]).toEqual(expect.objectContaining({
      source: 'estimated',
      paymentDate: '2026-09-30',
    }));
  });

  it('prefers a confirmed month-specific amount without counting it as another transaction', () => {
    const cardsWithConfirmedAmount: PaymentCard[] = [{
      ...cards[0],
      monthlyPaymentAmounts: { '2026-09': 310_000 },
    }];
    const summary = calculateMonthlyCardSettlementSummary('2026-09', [
      transaction({ cardId: 'credit', amount: 230_000 }),
    ], cardsWithConfirmedAmount);

    expect(summary.totalAmount).toBe(310_000);
    expect(summary.cards[0]).toEqual(expect.objectContaining({
      amount: 310_000,
      estimatedAmount: 230_000,
      source: 'confirmed',
    }));
  });

  it('uses the previous calendar month even when the payday cycle starts on the 10th', () => {
    const summary = calculateMonthlyCardSettlementSummary('2026-09', [
      transaction({ id: 'august-early', cardId: 'credit', localDate: '2026-08-05', amount: 140_000 }),
      transaction({ id: 'september-early', cardId: 'credit', localDate: '2026-09-05', amount: 90_000 }),
    ], cards, 10);

    expect(summary.totalAmount).toBe(140_000);
    expect(summary.linkedAccountTotal).toBe(140_000);
  });
});

describe('calculateCardPaymentSummary', () => {
  it('separates credit settlement estimates from debit and unassigned card usage', () => {
    const summary = calculateCardPaymentSummary('2026-08', [
      transaction({ id: 'allowance', cardId: 'credit', amount: 120_000 }),
      transaction({ id: 'fixed', cardId: 'credit', amount: 80_000, recurringTemplateId: 'subscription' }),
      transaction({ id: 'debit', cardId: 'debit', amount: 30_000 }),
      transaction({ id: 'unassigned', cardId: null, amount: 20_000 }),
    ], cards);

    expect(summary.totalCardUsage).toBe(250_000);
    expect(summary.creditCardUsage).toBe(200_000);
    expect(summary.debitCardUsage).toBe(30_000);
    expect(summary.unassignedCardUsage).toBe(20_000);
    expect(summary.estimatedNextPaymentTotal).toBe(200_000);
    expect(summary.creditCards[0]).toEqual(expect.objectContaining({
      allowanceAmount: 120_000,
      fixedAmount: 80_000,
      estimatedPaymentDate: '2026-09-30',
    }));
  });

  it('does not include another month or income transactions in the estimate', () => {
    const summary = calculateCardPaymentSummary('2026-08', [
      transaction({ localDate: '2026-07-31', cardId: 'credit' }),
      transaction({ type: 'income', cardId: 'credit' }),
    ], cards);

    expect(summary.totalCardUsage).toBe(0);
    expect(summary.estimatedNextPaymentTotal).toBe(0);
  });

  it('adds an unposted card-paid fixed expense to that card bill without a transaction', () => {
    const template: RecurringTemplate = {
      id: 'subscription', type: 'expense', name: '구독료', defaultAmount: 45_000,
      categoryId: 'subscriptions', counterparty: '구독 서비스', expenseNature: 'fixed', frequency: 'monthly',
      dayOfMonth: 25, holidayPolicy: 'fixed_date', postingMode: 'confirm', allowAmountChange: true,
      paymentMethodType: 'card', cardId: 'credit', startDate: '2026-01-01', nextDueDate: '2026-08-25',
      active: true, createdAt: now, updatedAt: now,
    };
    const pending: RecurringOccurrence = {
      id: 'pending-subscription', templateId: template.id, occurrenceKey: 'subscription_2026-08-25',
      scheduledDate: '2026-08-25', expectedAmount: 45_000, actualAmount: 52_000,
      status: 'needs_confirmation', createdAt: now, updatedAt: now,
    };

    const summary = calculateCardPaymentSummary('2026-08', [
      transaction({ id: 'allowance', cardId: 'credit', amount: 120_000 }),
    ], cards, 1, [pending], [template]);

    expect(summary.estimatedNextPaymentTotal).toBe(172_000);
    expect(summary.scheduledFixedCardUsage).toBe(52_000);
    expect(summary.creditCards[0]).toEqual(expect.objectContaining({
      fixedAmount: 52_000,
      scheduledFixedAmount: 52_000,
    }));
  });

  it('includes only the applicable installment round in each projected card month', () => {
    const installmentTx = transaction({
      id: 'installment', cardId: 'credit', amount: 300_000, localDate: '2026-06-10',
      installment: { totalMonths: 3, currentRound: 2, baseYearMonth: '2026-08' },
    });

    expect(calculateCardPaymentSummary('2026-08', [installmentTx], cards).estimatedNextPaymentTotal).toBe(100_000);
    expect(calculateCardPaymentSummary('2026-08', [installmentTx], cards).creditCards[0]).toEqual(expect.objectContaining({
      installmentAmount: 100_000,
      installments: [expect.objectContaining({ round: 2, totalMonths: 3 })],
    }));
    expect(calculateCardPaymentSummary('2026-09', [installmentTx], cards).estimatedNextPaymentTotal).toBe(100_000);
    expect(calculateCardPaymentSummary('2026-10', [installmentTx], cards).estimatedNextPaymentTotal).toBe(0);
    expect(calculateCardPaymentSummary('2026-06', [installmentTx], cards).estimatedNextPaymentTotal).toBe(0);
  });
});
