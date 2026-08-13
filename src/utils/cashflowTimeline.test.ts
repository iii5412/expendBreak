import { describe, expect, it } from 'vitest';
import { buildCashflowTimeline } from './cashflowTimeline';
import { getAccountingPeriod } from './calculations';
import type { BankAccount, RecurringOccurrence, Transaction } from '../types';
import type { MonthlyCardSettlementSummary, MonthlyCardSettlement } from './cardPayments';

const NOW = new Date(2026, 7, 12); // 2026-08-12
const PERIOD = getAccountingPeriod('2026-08', 10, NOW); // 8/10 ~ 9/9

const ACCOUNT: BankAccount = {
  id: 'acc_main',
  bankName: 'KB국민',
  accountName: '생활비 통장',
  accountNumber: '',
  accountHolder: '',
  balance: 1_000_000,
  createdAt: '',
  updatedAt: '',
};

const makeTransaction = (overrides: Partial<Transaction>): Transaction => ({
  id: `tx_${Math.random().toString(36).slice(2)}`,
  type: 'expense',
  amount: 0,
  occurredAt: '',
  localDate: '2026-08-11',
  categoryId: 'food',
  merchant: '',
  memo: '',
  source: 'manual',
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const settlement = (cards: Partial<MonthlyCardSettlement>[]): MonthlyCardSettlementSummary => ({
  yearMonth: '2026-08',
  totalAmount: cards.reduce((sum, card) => sum + (card.amount || 0), 0),
  linkedAccountTotal: 0,
  unlinkedAmount: 0,
  cards: cards.map(card => ({
    cardId: 'card_1',
    cardName: '신한 딥드림',
    cardCompany: '신한카드',
    linkedAccountId: 'acc_main',
    paymentDate: '2026-08-25',
    usageYearMonth: '2026-07',
    usageStartDate: '2026-07-01',
    usageEndDate: '2026-07-31',
    hasStatementWindow: false,
    amount: 0,
    estimatedAmount: 0,
    source: 'estimated' as const,
    status: 'scheduled' as const,
    ...card,
  })),
});

const emptySettlement = settlement([]);

describe('cashflow timeline', () => {
  it('covers every day of the cycle', () => {
    const timeline = buildCashflowTimeline(PERIOD, [], [], [], [ACCOUNT], emptySettlement, 0, NOW);

    expect(timeline.points).toHaveLength(PERIOD.daysInMonth);
    expect(timeline.points[0].date).toBe('2026-08-10');
    expect(timeline.points[timeline.points.length - 1].date).toBe('2026-09-09');
  });

  it('leaves the balance flat with no movements and no spending', () => {
    const timeline = buildCashflowTimeline(PERIOD, [], [], [], [ACCOUNT], emptySettlement, 0, NOW);

    expect(timeline.points.every(point => point.balance === 1_000_000)).toBe(true);
    expect(timeline.shortfallDate).toBeNull();
  });

  it('drops the balance on the card payment date', () => {
    const timeline = buildCashflowTimeline(
      PERIOD, [], [], [], [ACCOUNT], settlement([{ amount: 400_000 }]), 0, NOW,
    );

    const beforePayment = timeline.points.find(point => point.date === '2026-08-24');
    const onPayment = timeline.points.find(point => point.date === '2026-08-25');

    expect(beforePayment?.balance).toBe(1_000_000);
    expect(onPayment?.balance).toBe(600_000);
  });

  it('flags the first day the balance goes negative', () => {
    const timeline = buildCashflowTimeline(
      PERIOD, [], [], [], [ACCOUNT], settlement([{ amount: 1_200_000 }]), 0, NOW,
    );

    expect(timeline.shortfallDate).toBe('2026-08-25');
    expect(timeline.lowestBalance).toBe(-200_000);
  });

  it('does not treat a card purchase as a withdrawal', () => {
    const cardPurchase = makeTransaction({
      amount: 300_000, localDate: '2026-08-11', paymentMethodType: 'card', cardId: 'card_1',
    });
    const timeline = buildCashflowTimeline(PERIOD, [cardPurchase], [], [], [ACCOUNT], emptySettlement, 0, NOW);

    expect(timeline.points.every(point => point.balance === 1_000_000)).toBe(true);
  });

  it('treats a settlement transaction as a real withdrawal', () => {
    const paid = makeTransaction({
      amount: 400_000, localDate: '2026-08-25', role: 'card_settlement',
      paymentMethodType: 'account', accountId: 'acc_main',
    });
    const timeline = buildCashflowTimeline(PERIOD, [paid], [], [], [ACCOUNT], emptySettlement, 0, NOW);

    expect(timeline.points.find(point => point.date === '2026-08-25')?.balance).toBe(600_000);
  });

  it('carries the spending trend into future days only', () => {
    const timeline = buildCashflowTimeline(PERIOD, [], [], [], [ACCOUNT], emptySettlement, 10_000, NOW);

    const today = timeline.points.find(point => point.date === '2026-08-12');
    const tomorrow = timeline.points.find(point => point.date === '2026-08-13');

    expect(today?.projected).toBe(false);
    expect(today?.balance).toBe(1_000_000);
    expect(tomorrow?.projected).toBe(true);
    expect(tomorrow?.balance).toBe(990_000);
  });

  it('applies a pending recurring transfer on its scheduled date', () => {
    const occurrence: RecurringOccurrence = {
      id: 'occ_rent', templateId: 't_rent', occurrenceKey: '', scheduledDate: '2026-08-20',
      expectedAmount: 700_000, actualAmount: null, status: 'needs_confirmation',
      typeSnapshot: 'expense', paymentMethodType: 'account', createdAt: '', updatedAt: '',
    };
    const timeline = buildCashflowTimeline(PERIOD, [], [occurrence], [], [ACCOUNT], emptySettlement, 0, NOW);

    expect(timeline.points.find(point => point.date === '2026-08-20')?.balance).toBe(300_000);
  });

  it('reports no usable line without a recorded balance', () => {
    const timeline = buildCashflowTimeline(
      PERIOD, [], [], [], [{ ...ACCOUNT, balance: 0 }], emptySettlement, 0, NOW,
    );

    expect(timeline.hasStartingBalance).toBe(false);
  });

  it('skips a card bill already marked paid', () => {
    const timeline = buildCashflowTimeline(
      PERIOD, [], [], [], [ACCOUNT], settlement([{ amount: 400_000, status: 'paid' }]), 0, NOW,
    );

    expect(timeline.points.every(point => point.balance === 1_000_000)).toBe(true);
  });
});
