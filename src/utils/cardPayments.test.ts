import { describe, expect, it } from 'vitest';
import { PaymentCard, Transaction } from '../types';
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
});
