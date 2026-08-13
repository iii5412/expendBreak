import { describe, expect, it } from 'vitest';
import { calculateFutureCommitments } from './futureCommitments';
import type { PaymentCard, RecurringTemplate, Transaction } from '../types';

const SALARY_DAY = 10;

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

const RENT: RecurringTemplate = {
  id: 't_rent',
  type: 'expense',
  name: '월세',
  defaultAmount: 700_000,
  categoryId: 'housing_utilities',
  counterparty: '',
  frequency: 'monthly',
  dayOfMonth: 10,
  holidayPolicy: 'fixed_date',
  postingMode: 'confirm',
  allowAmountChange: true,
  paymentMethodType: 'account',
  startDate: '2026-01-01',
  nextDueDate: '2026-08-10',
  active: true,
  createdAt: '',
  updatedAt: '',
};

const CARD: PaymentCard = {
  id: 'card_1',
  cardName: '신한 딥드림',
  cardCompany: '신한카드',
  cardType: 'credit',
  linkedAccountId: 'acc_main',
  billingDay: 25,
  createdAt: '',
  updatedAt: '',
};

describe('future commitments', () => {
  it('projects recurring transfers across every cycle in range', () => {
    const { months } = calculateFutureCommitments('2026-08', [], [RENT], [], [], SALARY_DAY, 6);

    expect(months).toHaveLength(6);
    expect(months.map(month => month.yearMonth)).toEqual([
      '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01',
    ]);
    expect(months.every(month => month.accountFixed === 700_000)).toBe(true);
  });

  it('stops a template after its end date', () => {
    const ending = { ...RENT, endDate: '2026-10-31' };
    const { months } = calculateFutureCommitments('2026-08', [], [ending], [], [], SALARY_DAY, 6);

    expect(months.map(month => month.accountFixed)).toEqual([700_000, 700_000, 700_000, 0, 0, 0]);
  });

  it('carries an installment for its remaining rounds and then frees the money', () => {
    const purchase = makeTransaction({
      amount: 300_000,
      merchant: '노트북',
      paymentMethodType: 'card',
      cardId: CARD.id,
      installment: { totalMonths: 3, currentRound: 1, baseYearMonth: '2026-08' },
    });

    const { months } = calculateFutureCommitments('2026-08', [purchase], [], [], [CARD], SALARY_DAY, 6);

    // Billed on the 25th, so the 2026-09 cycle charges August usage (round 1).
    expect(months.map(month => month.installments)).toEqual([0, 100_000, 100_000, 100_000, 0, 0]);
  });

  it('flags the cycle where an installment ends', () => {
    const purchase = makeTransaction({
      amount: 300_000,
      merchant: '노트북',
      paymentMethodType: 'card',
      cardId: CARD.id,
      installment: { totalMonths: 3, currentRound: 1, baseYearMonth: '2026-08' },
    });

    const { months } = calculateFutureCommitments('2026-08', [purchase], [], [], [CARD], SALARY_DAY, 6);
    const ending = months.filter(month => month.endingInstallments.length > 0);

    expect(ending).toHaveLength(1);
    expect(ending[0].yearMonth).toBe('2026-11');
    expect(ending[0].endingInstallments[0]).toMatchObject({ merchant: '노트북', totalMonths: 3 });
  });

  it('does not count installment rounds twice inside the card bill', () => {
    const purchase = makeTransaction({
      amount: 300_000,
      paymentMethodType: 'card',
      cardId: CARD.id,
      installment: { totalMonths: 3, currentRound: 1, baseYearMonth: '2026-08' },
    });

    const { months } = calculateFutureCommitments('2026-08', [purchase], [], [], [CARD], SALARY_DAY, 6);
    const september = months.find(month => month.yearMonth === '2026-09');

    expect(september?.installments).toBe(100_000);
    expect(september?.cardSettlement).toBe(0);
    expect(september?.total).toBe(100_000);
  });

  it('reports the peak for bar scaling', () => {
    const { peak } = calculateFutureCommitments('2026-08', [], [RENT], [], [], SALARY_DAY, 6);

    expect(peak).toBe(700_000);
  });
});
