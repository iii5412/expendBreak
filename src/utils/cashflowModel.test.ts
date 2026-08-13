import { describe, it, expect } from 'vitest';
import { calculateMonthSummary, getAccountingPeriod, isDateInPeriod } from './calculations';
import {
  calculateCardPaymentSummary,
  calculateMonthlyCardSettlementSummary,
  getCardSettlementSchedule,
} from './cardPayments';
import type {
  Budget,
  CycleBaseline,
  PaymentCard,
  RecurringOccurrence,
  RecurringTemplate,
  Transaction,
} from '../types';

/**
 * Guards the two-track cash model in `docs/PRD-payday-cashflow-model.md` §4.
 * Every amount must land in exactly one track of exactly one cycle.
 */

const NOW = new Date(2026, 7, 12); // 2026-08-12
const SALARY_DAY = 10;

const makeTransaction = (overrides: Partial<Transaction>): Transaction => ({
  id: `tx_${Math.random().toString(36).slice(2)}`,
  type: 'expense',
  amount: 0,
  occurredAt: '',
  localDate: '2026-08-12',
  categoryId: 'food',
  merchant: '',
  memo: '',
  source: 'manual',
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const makeTemplate = (overrides: Partial<RecurringTemplate>): RecurringTemplate => ({
  id: `tmpl_${Math.random().toString(36).slice(2)}`,
  type: 'expense',
  name: '고정비',
  defaultAmount: 0,
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
  ...overrides,
});

const makeOccurrence = (overrides: Partial<RecurringOccurrence>): RecurringOccurrence => ({
  id: `occ_${Math.random().toString(36).slice(2)}`,
  templateId: '',
  occurrenceKey: '',
  scheduledDate: '2026-08-10',
  expectedAmount: 0,
  actualAmount: null,
  status: 'needs_confirmation',
  typeSnapshot: 'expense',
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const CREDIT_CARD: PaymentCard = {
  id: 'card_shinhan',
  cardName: '신한 딥드림',
  cardCompany: '신한카드',
  cardType: 'credit',
  linkedAccountId: 'acc_main',
  billingDay: 25,
  createdAt: '',
  updatedAt: '',
};

const budgetWithLimit = (totalLimit: number): Budget => ({
  yearMonth: '2026-08',
  totalLimit,
  thresholds: [0.7, 0.85, 1],
  createdAt: '',
  updatedAt: '',
});

/** The PRD §1 reference scenario: salary 3M, 780k transferred, 900k card bill. */
function referenceScenario() {
  const salary = makeTemplate({ id: 't_salary', type: 'income', name: '급여', categoryId: 'salary', defaultAmount: 3_000_000 });
  const rent = makeTemplate({ id: 't_rent', name: '월세', defaultAmount: 700_000 });
  const telco = makeTemplate({ id: 't_telco', name: '통신비', defaultAmount: 80_000 });

  const transactions: Transaction[] = [
    makeTransaction({ type: 'income', amount: 3_000_000, localDate: '2026-08-10', categoryId: 'salary', recurringTemplateId: 't_salary', paymentMethodType: 'account' }),
    makeTransaction({ amount: 700_000, localDate: '2026-08-10', recurringTemplateId: 't_rent', paymentMethodType: 'account' }),
    makeTransaction({ amount: 80_000, localDate: '2026-08-10', recurringTemplateId: 't_telco', paymentMethodType: 'account' }),
    // July card usage — billed on 2026-08-25, inside the 8/10~9/9 cycle.
    makeTransaction({ amount: 900_000, localDate: '2026-07-15', paymentMethodType: 'card', cardId: CREDIT_CARD.id }),
    // Spending inside the current cycle, charged to the same card.
    makeTransaction({ amount: 300_000, localDate: '2026-08-11', paymentMethodType: 'card', cardId: CREDIT_CARD.id }),
  ];

  const settlement = calculateMonthlyCardSettlementSummary('2026-08', transactions, [CREDIT_CARD], SALARY_DAY);
  const summary = calculateMonthSummary(
    '2026-08', transactions, [], budgetWithLimit(1_000_000), [salary, rent, telco], NOW, SALARY_DAY,
    { cardSettlementOutflow: settlement.totalAmount },
  );
  return { summary, settlement, transactions };
}

describe('PRD §1 reference scenario', () => {
  it('secures the card bill alongside account transfers', () => {
    const { summary, settlement } = referenceScenario();

    expect(settlement.totalAmount).toBe(900_000);
    expect(summary.accountFixedOutflow).toBe(780_000);
    expect(summary.cardSettlementOutflow).toBe(900_000);
    expect(summary.totalExpectedFixedExpenses).toBe(1_680_000);
  });

  it('reports 1,320,000 as the cycle living budget', () => {
    const { summary } = referenceScenario();

    expect(summary.livingBudget).toBe(1_320_000);
    expect(summary.remainingLivingBudget).toBe(1_320_000 - 300_000);
  });

  it('no longer overstates planned savings by the card bill', () => {
    const { summary } = referenceScenario();

    // Was 1,220,000 before the card bill entered the cash track.
    expect(summary.plannedSavings).toBe(320_000);
  });
});

describe('INV-1 single ownership', () => {
  it('keeps a card-paid recurring expense out of the account transfer total', () => {
    const cardTelco = makeTemplate({ id: 't_telco', name: '통신비', defaultAmount: 80_000, paymentMethodType: 'card', cardId: CREDIT_CARD.id });
    const rent = makeTemplate({ id: 't_rent', name: '월세', defaultAmount: 700_000 });
    const occurrences = [
      makeOccurrence({ templateId: 't_telco', scheduledDate: '2026-08-20', expectedAmount: 80_000, paymentMethodType: 'card', cardId: CREDIT_CARD.id }),
      makeOccurrence({ templateId: 't_rent', scheduledDate: '2026-08-10', expectedAmount: 700_000, paymentMethodType: 'account' }),
    ];

    const summary = calculateMonthSummary(
      '2026-08', [], occurrences, budgetWithLimit(0), [cardTelco, rent], NOW, SALARY_DAY,
    );

    expect(summary.accountFixedOutflow).toBe(700_000);
    expect(summary.cardFixedExpenses).toBe(80_000);
    // Still counted once as a pending recurring item overall.
    expect(summary.remainingScheduledExpenses).toBe(780_000);
  });

  it('splits confirmed recurring transactions by payment method', () => {
    const cardTelco = makeTemplate({ id: 't_telco', paymentMethodType: 'card', cardId: CREDIT_CARD.id, defaultAmount: 80_000 });
    const rent = makeTemplate({ id: 't_rent', defaultAmount: 700_000 });
    const transactions = [
      makeTransaction({ amount: 80_000, localDate: '2026-08-20', recurringTemplateId: 't_telco', paymentMethodType: 'card', cardId: CREDIT_CARD.id }),
      makeTransaction({ amount: 700_000, localDate: '2026-08-10', recurringTemplateId: 't_rent', paymentMethodType: 'account' }),
    ];

    const summary = calculateMonthSummary(
      '2026-08', transactions, [], budgetWithLimit(0), [cardTelco, rent], NOW, SALARY_DAY,
    );

    expect(summary.confirmedFixedExpenses).toBe(780_000);
    expect(summary.confirmedAccountFixedOutflow).toBe(700_000);
    expect(summary.accountFixedOutflow).toBe(700_000);
    expect(summary.cardFixedExpenses).toBe(80_000);
  });

  it('excludes an unmaterialized card-paid template from the transfer total', () => {
    const cardSubscription = makeTemplate({ id: 't_sub', dayOfMonth: 20, defaultAmount: 15_000, paymentMethodType: 'card', cardId: CREDIT_CARD.id });
    const rent = makeTemplate({ id: 't_rent', defaultAmount: 700_000 });

    const summary = calculateMonthSummary(
      '2026-08', [], [], budgetWithLimit(0), [cardSubscription, rent], NOW, SALARY_DAY,
    );

    expect(summary.accountFixedOutflow).toBe(700_000);
    expect(summary.cardFixedExpenses).toBe(15_000);
  });
});

describe('INV-2 track separation', () => {
  it('charges a card purchase to the spend track once and the cash track once, in different cycles', () => {
    const purchase = makeTransaction({ amount: 300_000, localDate: '2026-08-11', paymentMethodType: 'card', cardId: CREDIT_CARD.id });
    const transactions = [purchase];

    // Cycle 2026-08 (8/10~9/9): the purchase is spending, nothing is billed yet.
    const augustSettlement = calculateMonthlyCardSettlementSummary('2026-08', transactions, [CREDIT_CARD], SALARY_DAY);
    const august = calculateMonthSummary(
      '2026-08', transactions, [], budgetWithLimit(0), [], NOW, SALARY_DAY,
      { cardSettlementOutflow: augustSettlement.totalAmount },
    );

    // Cycle 2026-09 (9/10~10/9): the bill arrives on 9/25, the purchase is history.
    const septemberSettlement = calculateMonthlyCardSettlementSummary('2026-09', transactions, [CREDIT_CARD], SALARY_DAY);
    const september = calculateMonthSummary(
      '2026-09', transactions, [], budgetWithLimit(0), [], new Date(2026, 8, 12), SALARY_DAY,
      { cardSettlementOutflow: septemberSettlement.totalAmount },
    );

    expect(august.confirmedVariableExpenses).toBe(300_000);
    expect(august.cardSettlementOutflow).toBe(0);

    expect(september.confirmedVariableExpenses).toBe(0);
    expect(september.cardSettlementOutflow).toBe(300_000);
  });

  it('never counts the same amount in both tracks of one cycle', () => {
    const { summary, settlement } = referenceScenario();

    // Spend track holds only the current cycle's purchases.
    expect(summary.confirmedVariableExpenses).toBe(300_000);
    // Cash track holds only the previous month's usage.
    expect(settlement.totalAmount).toBe(900_000);
    expect(summary.confirmedVariableExpenses + summary.cardSettlementOutflow).toBe(1_200_000);
  });

  it('conserves total outflow across consecutive cycles', () => {
    const transactions = [
      makeTransaction({ amount: 200_000, localDate: '2026-07-05', paymentMethodType: 'card', cardId: CREDIT_CARD.id }),
      makeTransaction({ amount: 300_000, localDate: '2026-08-11', paymentMethodType: 'card', cardId: CREDIT_CARD.id }),
      makeTransaction({ amount: 150_000, localDate: '2026-09-20', paymentMethodType: 'card', cardId: CREDIT_CARD.id }),
    ];
    const cycles = ['2026-08', '2026-09', '2026-10', '2026-11'];

    const billed = cycles.reduce(
      (sum, cycle) => sum + calculateMonthlyCardSettlementSummary(cycle, transactions, [CREDIT_CARD], SALARY_DAY).totalAmount,
      0,
    );
    const purchased = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);

    expect(billed).toBe(purchased);
  });
});

describe('INV-3 cycle attribution', () => {
  it('places a bill in the cycle containing its payment date', () => {
    const period = getAccountingPeriod('2026-08', SALARY_DAY);

    for (const billingDay of [5, 14, 25]) {
      const { paymentDate } = getCardSettlementSchedule('2026-08', billingDay, SALARY_DAY);
      expect(paymentDate).not.toBeNull();
      expect(isDateInPeriod(paymentDate as string, period)).toBe(true);
    }
  });

  it('charges August usage when the billing day falls after the salary day boundary', () => {
    // Billing day 5 with salary day 10: the bill inside 8/10~9/9 is withdrawn on
    // 9/5 and therefore charges August, not July.
    expect(getCardSettlementSchedule('2026-08', 5, SALARY_DAY)).toMatchObject({
      paymentDate: '2026-09-05',
      usageYearMonth: '2026-08',
    });
    expect(getCardSettlementSchedule('2026-08', 25, SALARY_DAY)).toMatchObject({
      paymentDate: '2026-08-25',
      usageYearMonth: '2026-07',
    });
  });

  it('bills an early-billing-day card exactly once across cycles', () => {
    const earlyCard: PaymentCard = { ...CREDIT_CARD, billingDay: 5 };
    const transactions = [
      makeTransaction({ amount: 400_000, localDate: '2026-08-20', paymentMethodType: 'card', cardId: earlyCard.id }),
    ];

    const august = calculateMonthlyCardSettlementSummary('2026-08', transactions, [earlyCard], SALARY_DAY);
    const september = calculateMonthlyCardSettlementSummary('2026-09', transactions, [earlyCard], SALARY_DAY);

    expect(august.totalAmount).toBe(400_000); // withdrawn 2026-09-05, inside 8/10~9/9
    expect(september.totalAmount).toBe(0);
  });

  it('keeps calendar-month behaviour when the salary day is 1', () => {
    expect(getCardSettlementSchedule('2026-08', 25, 1)).toMatchObject({
      paymentDate: '2026-08-25',
      usageYearMonth: '2026-07',
      hasStatementWindow: false,
    });
  });
});

describe('statement windows', () => {
  it('bills the real window when a closing day is set', () => {
    // Shinhan: 25th payment closes on the 11th → 7/12 ~ 8/11.
    expect(getCardSettlementSchedule('2026-08', 25, SALARY_DAY, 11)).toMatchObject({
      paymentDate: '2026-08-25',
      usageStartDate: '2026-07-12',
      usageEndDate: '2026-08-11',
      usageYearMonth: '2026-08',
      hasStatementWindow: true,
    });
  });

  it('falls back to the previous calendar month without a closing day', () => {
    expect(getCardSettlementSchedule('2026-08', 25, SALARY_DAY)).toMatchObject({
      usageStartDate: '2026-07-01',
      usageEndDate: '2026-07-31',
      hasStatementWindow: false,
    });
  });

  it('steps back a month when the closing day falls after the payment date', () => {
    // Closing on the 22nd with payment on the 5th: the 8/5 bill closed on 7/22.
    expect(getCardSettlementSchedule('2026-07', 5, 1, 22)).toMatchObject({
      paymentDate: '2026-07-05',
      usageStartDate: '2026-05-23',
      usageEndDate: '2026-06-22',
      hasStatementWindow: true,
    });
  });

  it('charges a purchase made after the closing day to the next bill', () => {
    const card: PaymentCard = { ...CREDIT_CARD, statementClosingDay: 11 };
    // 8/20 falls after the 8/11 close, so it belongs to the 9/25 bill.
    const purchase = makeTransaction({
      amount: 200_000, localDate: '2026-08-20', paymentMethodType: 'card', cardId: card.id,
    });

    const august = calculateMonthlyCardSettlementSummary('2026-08', [purchase], [card], SALARY_DAY);
    const september = calculateMonthlyCardSettlementSummary('2026-09', [purchase], [card], SALARY_DAY);

    expect(august.totalAmount).toBe(0);
    expect(september.totalAmount).toBe(200_000);
  });

  it('charges a purchase made before the closing day to this bill', () => {
    const card: PaymentCard = { ...CREDIT_CARD, statementClosingDay: 11 };
    const purchase = makeTransaction({
      amount: 200_000, localDate: '2026-08-05', paymentMethodType: 'card', cardId: card.id,
    });

    expect(calculateMonthlyCardSettlementSummary('2026-08', [purchase], [card], SALARY_DAY).totalAmount)
      .toBe(200_000);
  });

  it('still bills each purchase exactly once across cycles', () => {
    const card: PaymentCard = { ...CREDIT_CARD, statementClosingDay: 11 };
    const transactions = [
      makeTransaction({ amount: 100_000, localDate: '2026-07-05', paymentMethodType: 'card', cardId: card.id }),
      makeTransaction({ amount: 200_000, localDate: '2026-08-20', paymentMethodType: 'card', cardId: card.id }),
      makeTransaction({ amount: 300_000, localDate: '2026-09-11', paymentMethodType: 'card', cardId: card.id }),
    ];
    const cycles = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];

    const billed = cycles.reduce(
      (sum, cycle) => sum + calculateMonthlyCardSettlementSummary(cycle, transactions, [card], SALARY_DAY).totalAmount,
      0,
    );

    expect(billed).toBe(600_000);
  });
});

describe('payday morning before the salary is confirmed', () => {
  /** Salary due today and unposted, fixed expenses pending, some card spending done. */
  const paydayMorning = (limit: number) => {
    const salary = makeTemplate({ id: 't_salary', type: 'income', categoryId: 'salary', defaultAmount: 3_000_000 });
    const rent = makeTemplate({ id: 't_rent', name: '월세', defaultAmount: 700_000 });
    const telco = makeTemplate({ id: 't_telco', name: '통신비', defaultAmount: 80_000 });
    const occurrences = [
      makeOccurrence({ templateId: 't_salary', scheduledDate: '2026-08-10', expectedAmount: 3_000_000, typeSnapshot: 'income' }),
      makeOccurrence({ templateId: 't_rent', scheduledDate: '2026-08-10', expectedAmount: 700_000 }),
      makeOccurrence({ templateId: 't_telco', scheduledDate: '2026-08-10', expectedAmount: 80_000 }),
    ];
    const transactions = [makeTransaction({ amount: 300_000, localDate: '2026-08-11' })];

    return calculateMonthSummary(
      '2026-08', transactions, occurrences, budgetWithLimit(limit), [salary, rent, telco], NOW, SALARY_DAY,
    );
  };

  it('plans on scheduled income instead of collapsing to an overrun', () => {
    const summary = paydayMorning(1_000_000);

    expect(summary.isProjected).toBe(true);
    expect(summary.planningIncome).toBe(3_000_000);
    expect(summary.livingBudget).toBe(2_220_000);
    expect(summary.budgetUsagePercent).toBe(30);
    expect(summary.alertLevel).toBe('safe');
  });

  it('keeps confirmed income reporting honest while planning ahead', () => {
    const summary = paydayMorning(1_000_000);

    expect(summary.totalIncome).toBe(0);
    expect(summary.confirmedIncome).toBe(0);
    expect(summary.scheduledIncome).toBe(3_000_000);
  });

  it('stops projecting once the deposit is confirmed', () => {
    const salary = makeTemplate({ id: 't_salary', type: 'income', categoryId: 'salary', defaultAmount: 3_000_000 });
    const transactions = [
      makeTransaction({ type: 'income', amount: 3_000_000, localDate: '2026-08-10', categoryId: 'salary', recurringTemplateId: 't_salary' }),
    ];

    const summary = calculateMonthSummary(
      '2026-08', transactions, [], budgetWithLimit(0), [salary], NOW, SALARY_DAY,
    );

    expect(summary.isProjected).toBe(false);
    expect(summary.planningIncome).toBe(3_000_000);
  });

  it('reports nothing to plan with when there is no income at all', () => {
    const summary = calculateMonthSummary(
      '2026-08', [], [], budgetWithLimit(0), [], NOW, SALARY_DAY,
    );

    expect(summary.isProjected).toBe(false);
    expect(summary.livingBudget).toBe(0);
    expect(summary.alertLevel).toBe('safe');
  });
});

describe('allowance limit as an optional cap', () => {
  it('falls back to the full living budget when no limit is set', () => {
    const salary = makeTemplate({ id: 't_salary', type: 'income', categoryId: 'salary', defaultAmount: 2_000_000 });
    const transactions = [
      makeTransaction({ type: 'income', amount: 2_000_000, localDate: '2026-08-10', categoryId: 'salary', recurringTemplateId: 't_salary' }),
      makeTransaction({ amount: 100_000, localDate: '2026-08-11' }),
    ];

    const summary = calculateMonthSummary(
      '2026-08', transactions, [], budgetWithLimit(0), [salary], NOW, SALARY_DAY,
    );

    expect(summary.livingBudget).toBe(2_000_000);
    expect(summary.spendableLimit).toBe(2_000_000);
    expect(summary.remainingAllowance).toBe(1_900_000);
    expect(summary.budgetUsagePercent).toBe(5);
  });

  it('caps spending at the limit when one is set', () => {
    const salary = makeTemplate({ id: 't_salary', type: 'income', categoryId: 'salary', defaultAmount: 2_000_000 });
    const transactions = [
      makeTransaction({ type: 'income', amount: 2_000_000, localDate: '2026-08-10', categoryId: 'salary', recurringTemplateId: 't_salary' }),
    ];

    const summary = calculateMonthSummary(
      '2026-08', transactions, [], budgetWithLimit(800_000), [salary], NOW, SALARY_DAY,
    );

    expect(summary.livingBudget).toBe(2_000_000);
    expect(summary.spendableLimit).toBe(800_000);
    expect(summary.plannedSavings).toBe(1_200_000);
  });
});

describe('INV-5 installment symmetry', () => {
  const purchase = makeTransaction({
    amount: 1_200_000,
    localDate: '2026-08-11',
    paymentMethodType: 'card',
    cardId: CREDIT_CARD.id,
    installment: { totalMonths: 12, currentRound: 1, baseYearMonth: '2026-08' },
  });

  const spendIn = (yearMonth: string, now: Date) => calculateMonthSummary(
    yearMonth, [purchase], [], budgetWithLimit(0), [], now, SALARY_DAY,
  ).confirmedVariableExpenses;

  it('charges only the round due, not the whole purchase', () => {
    expect(spendIn('2026-08', NOW)).toBe(100_000);
  });

  it('keeps charging later rounds in later cycles', () => {
    expect(spendIn('2026-09', new Date(2026, 8, 12))).toBe(100_000);
    expect(spendIn('2027-01', new Date(2027, 0, 12))).toBe(100_000);
  });

  it('stops after the final round', () => {
    expect(spendIn('2027-07', new Date(2027, 6, 12))).toBe(100_000); // round 12
    expect(spendIn('2027-08', new Date(2027, 7, 12))).toBe(0);
  });

  it('spreads the exact purchase amount over the plan and no more', () => {
    const cycles = ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01',
      '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08'];
    const total = cycles.reduce(
      (sum, cycle) => sum + calculateMonthSummary(
        cycle, [purchase], [], budgetWithLimit(0), [], NOW, SALARY_DAY,
      ).confirmedVariableExpenses,
      0,
    );

    expect(total).toBe(1_200_000);
  });

  it('matches what the card bill charges for the same round', () => {
    // Bill paid on 2026-09-25 charges August usage, which holds round 1.
    const settlement = calculateMonthlyCardSettlementSummary('2026-09', [purchase], [CREDIT_CARD], SALARY_DAY);

    expect(settlement.totalAmount).toBe(spendIn('2026-08', NOW));
  });

  it('leaves a one-off purchase counted in full', () => {
    const outright = makeTransaction({ amount: 300_000, localDate: '2026-08-11' });
    const summary = calculateMonthSummary(
      '2026-08', [outright], [], budgetWithLimit(0), [], NOW, SALARY_DAY,
    );

    expect(summary.confirmedVariableExpenses).toBe(300_000);
  });
});

describe('INV-4 baseline lock', () => {
  const lockedBaseline = (overrides: Partial<CycleBaseline> = {}): CycleBaseline => ({
    yearMonth: '2026-08',
    confirmedIncome: 3_000_000,
    accountFixedOutflow: 780_000,
    cardSettlement: 900_000,
    savingsReserve: 0,
    livingBudget: 1_320_000,
    lockedAt: '2026-08-10T03:00:00.000Z',
    revisions: [],
    createdAt: '2026-08-10T03:00:00.000Z',
    updatedAt: '2026-08-10T03:00:00.000Z',
    ...overrides,
  });

  /** Same cycle as the reference scenario, but a fixed expense grew by 15,000 after payday. */
  function scenarioWithLateChange(baseline: CycleBaseline | null) {
    const salary = makeTemplate({ id: 't_salary', type: 'income', categoryId: 'salary', defaultAmount: 3_000_000 });
    const rent = makeTemplate({ id: 't_rent', defaultAmount: 700_000 });
    const telco = makeTemplate({ id: 't_telco', defaultAmount: 95_000 }); // was 80,000
    const transactions = [
      makeTransaction({ type: 'income', amount: 3_000_000, localDate: '2026-08-10', categoryId: 'salary', recurringTemplateId: 't_salary' }),
      makeTransaction({ amount: 700_000, localDate: '2026-08-10', recurringTemplateId: 't_rent', paymentMethodType: 'account' }),
      makeTransaction({ amount: 95_000, localDate: '2026-08-10', recurringTemplateId: 't_telco', paymentMethodType: 'account' }),
      makeTransaction({ amount: 300_000, localDate: '2026-08-11' }),
    ];

    return calculateMonthSummary(
      '2026-08', transactions, [], budgetWithLimit(0), [salary, rent, telco], NOW, SALARY_DAY,
      { cardSettlementOutflow: 900_000, baseline },
    );
  }

  it('holds the committed living budget when a fixed amount changes later', () => {
    const summary = scenarioWithLateChange(lockedBaseline());

    expect(summary.isBaselineLocked).toBe(true);
    expect(summary.livingBudget).toBe(1_320_000);
    expect(summary.remainingLivingBudget).toBe(1_020_000);
  });

  it('surfaces the drift instead of folding it into the balance', () => {
    const summary = scenarioWithLateChange(lockedBaseline());

    expect(summary.recalculatedLivingBudget).toBe(1_305_000);
    expect(summary.unplannedDelta).toBe(-15_000);
  });

  it('recomputes freely while no plan is locked', () => {
    const summary = scenarioWithLateChange(null);

    expect(summary.isBaselineLocked).toBe(false);
    expect(summary.livingBudget).toBe(1_305_000);
    expect(summary.unplannedDelta).toBe(0);
  });

  it('ignores a baseline belonging to another cycle', () => {
    const summary = scenarioWithLateChange(lockedBaseline({ yearMonth: '2026-07' }));

    expect(summary.isBaselineLocked).toBe(false);
    expect(summary.livingBudget).toBe(1_305_000);
  });

  it('spending still moves the remaining balance while locked', () => {
    const baseline = lockedBaseline();
    const salary = makeTemplate({ id: 't_salary', type: 'income', categoryId: 'salary', defaultAmount: 3_000_000 });
    const base = [
      makeTransaction({ type: 'income', amount: 3_000_000, localDate: '2026-08-10', categoryId: 'salary', recurringTemplateId: 't_salary' }),
    ];
    const options = { cardSettlementOutflow: 900_000, baseline };

    const before = calculateMonthSummary('2026-08', base, [], budgetWithLimit(0), [salary], NOW, SALARY_DAY, options);
    const after = calculateMonthSummary(
      '2026-08', [...base, makeTransaction({ amount: 50_000, localDate: '2026-08-12' })],
      [], budgetWithLimit(0), [salary], NOW, SALARY_DAY, options,
    );

    expect(before.remainingLivingBudget - after.remainingLivingBudget).toBe(50_000);
  });

  it('takes the savings reserve from the locked plan', () => {
    const summary = scenarioWithLateChange(lockedBaseline({ savingsReserve: 200_000, livingBudget: 1_120_000 }));

    expect(summary.savingsReserve).toBe(200_000);
    expect(summary.livingBudget).toBe(1_120_000);
    expect(summary.recalculatedLivingBudget).toBe(1_105_000);
  });
});

describe('savings reserve', () => {
  it('removes the reserve from the living budget', () => {
    const salary = makeTemplate({ id: 't_salary', type: 'income', categoryId: 'salary', defaultAmount: 3_000_000 });
    const transactions = [
      makeTransaction({ type: 'income', amount: 3_000_000, localDate: '2026-08-10', categoryId: 'salary', recurringTemplateId: 't_salary' }),
    ];

    const summary = calculateMonthSummary(
      '2026-08', transactions, [], budgetWithLimit(0), [salary], NOW, SALARY_DAY,
      { cardSettlementOutflow: 900_000, savingsReserve: 500_000 },
    );

    expect(summary.livingBudget).toBe(1_600_000);
    expect(summary.savingsReserve).toBe(500_000);
  });
});

describe('unmaterialized fixed expense safety net', () => {
  it('reserves a weekly item for every occurrence in the cycle', () => {
    const weekly = makeTemplate({
      id: 't_weekly', name: '주간 학원비', defaultAmount: 50_000,
      frequency: 'weekly', startDate: '2026-08-14',
    });

    const summary = calculateMonthSummary(
      '2026-08', [], [], budgetWithLimit(0), [weekly], NOW, SALARY_DAY,
    );

    // 8/14, 8/21, 8/28, 9/4 fall inside 8/10~9/9.
    expect(summary.accountFixedOutflow).toBe(200_000);
  });

  it('follows the holiday policy when placing a due date', () => {
    // 2026-08-15 is a Saturday; the previous business day is 8/14.
    const shifted = makeTemplate({
      id: 't_shifted', defaultAmount: 100_000, dayOfMonth: 15,
      holidayPolicy: 'previous_business_day',
    });
    const summary = calculateMonthSummary(
      '2026-08', [], [], budgetWithLimit(0), [shifted], NOW, SALARY_DAY,
    );

    expect(summary.accountFixedOutflow).toBe(100_000);
  });

  it('does not reserve an item whose due date leaves the cycle', () => {
    // Due on the 9th, before this cycle starts on the 10th.
    const early = makeTemplate({ id: 't_early', defaultAmount: 100_000, dayOfMonth: 9 });
    const summary = calculateMonthSummary(
      '2026-08', [], [], budgetWithLimit(0), [early], NOW, SALARY_DAY,
    );

    // The 9/9 occurrence still belongs to this cycle; the 8/9 one does not.
    expect(summary.accountFixedOutflow).toBe(100_000);
  });

  it('keeps a card-paid weekly item out of the transfer total', () => {
    const weeklyCard = makeTemplate({
      id: 't_weekly_card', defaultAmount: 50_000, frequency: 'weekly',
      startDate: '2026-08-14', paymentMethodType: 'card', cardId: CREDIT_CARD.id,
    });
    const summary = calculateMonthSummary(
      '2026-08', [], [], budgetWithLimit(0), [weeklyCard], NOW, SALARY_DAY,
    );

    expect(summary.accountFixedOutflow).toBe(0);
    expect(summary.cardFixedExpenses).toBe(200_000);
  });
});

describe('settlement transactions stay off the spend track', () => {
  it('excludes a card settlement from living-expense spending', () => {
    const settlement = makeTransaction({
      amount: 900_000, localDate: '2026-08-25', role: 'card_settlement',
      paymentMethodType: 'account',
    });
    const normal = makeTransaction({ amount: 30_000, localDate: '2026-08-12' });

    const summary = calculateMonthSummary(
      '2026-08', [settlement, normal], [], budgetWithLimit(0), [], NOW, SALARY_DAY,
    );

    expect(summary.confirmedVariableExpenses).toBe(30_000);
    expect(summary.confirmedExpenses).toBe(30_000);
  });

  // What "납부 완료" writes: an account withdrawal tagged as a card settlement,
  // carrying the card id so it shows in that card's history. It must never come
  // back as usage on the next bill.
  it('does not re-bill a paid bill into the following cycle', () => {
    const card = { ...CREDIT_CARD, billingDay: 10 };
    const augustBillPaid = makeTransaction({
      id: 'tx_card_settlement_card_shinhan_2026-08',
      amount: 2_850_000, localDate: '2026-08-10',
      role: 'card_settlement', settlementYearMonth: '2026-08',
      paymentMethodType: 'account', accountId: 'acc_main', cardId: card.id,
    });
    const augustUsage = makeTransaction({
      amount: 900_000, localDate: '2026-08-20',
      paymentMethodType: 'card', cardId: card.id,
    });

    const september = calculateMonthlyCardSettlementSummary(
      '2026-09', [augustBillPaid, augustUsage], [card], SALARY_DAY,
    );

    expect(september.cards[0].usageStartDate).toBe('2026-08-01');
    expect(september.cards[0].usageEndDate).toBe('2026-08-31');
    expect(september.totalAmount).toBe(900_000);
  });

  it('does not re-bill a settlement as card usage', () => {
    const settlement = makeTransaction({
      amount: 900_000, localDate: '2026-08-25', role: 'card_settlement',
      paymentMethodType: 'card', cardId: CREDIT_CARD.id,
    });

    expect(calculateCardPaymentSummary('2026-08', [settlement], [CREDIT_CARD], SALARY_DAY).totalCardUsage)
      .toBe(0);
  });
});

describe('spending pace', () => {
  const salary = makeTemplate({ id: 't_salary', type: 'income', categoryId: 'salary', defaultAmount: 3_000_000 });
  const income = makeTransaction({
    type: 'income', amount: 3_000_000, localDate: '2026-08-10',
    categoryId: 'salary', recurringTemplateId: 't_salary',
  });

  /** 8/17: day 17 of the 31-day spending window (8/1~8/31), so the pace has data. */
  const day8 = new Date(2026, 7, 17);

  const paceOn = (dailySpend: number) => {
    const spending = Array.from({ length: 7 }, (_, index) => makeTransaction({
      amount: dailySpend,
      localDate: `2026-08-${String(11 + index).padStart(2, '0')}`,
    }));
    return calculateMonthSummary(
      '2026-08', [income, ...spending], [], budgetWithLimit(0), [salary], day8, SALARY_DAY,
    );
  };

  // Pace is measured over the spending window (the calendar month), not the
  // cash cycle, so it lines up with the spending it is compared against.
  it('reports how far through the spending window the user is', () => {
    expect(paceOn(10_000).periodProgressPercent).toBe(55); // 8/17 of 8/1~8/31
  });

  it('projects a depletion date and shortfall when spending outruns the days', () => {
    // 3M budget, 7 days at 300k → 2.1M spent, 900k left, ~150k/day over the
    // 14-day window, so the remainder runs out well before 8/31.
    const summary = paceOn(300_000);

    expect(summary.projectedDepletionDate).not.toBeNull();
    expect(summary.projectedShortfallDays).toBeGreaterThan(0);
    expect(summary.requiredDailyPace).toBeLessThan(summary.forecastAverageDailyVariable);
  });

  it('reports no depletion when the pace is sustainable', () => {
    const summary = paceOn(10_000);

    expect(summary.projectedDepletionDate).toBeNull();
    expect(summary.projectedShortfallDays).toBe(0);
  });

  it('holds off until there is enough of the window to measure', () => {
    const early = makeTransaction({ amount: 500_000, localDate: '2026-08-01' });
    const summary = calculateMonthSummary(
      '2026-08', [income, early], [], budgetWithLimit(0), [salary], new Date(2026, 7, 2), SALARY_DAY,
    );

    expect(summary.spendDaysPassed).toBe(2);
    expect(summary.projectedDepletionDate).toBeNull();
  });

  it('flags an already-exhausted budget as depleted today', () => {
    const overspent = makeTransaction({ amount: 3_000_000, localDate: '2026-08-11' });
    const summary = calculateMonthSummary(
      '2026-08', [income, overspent], [], budgetWithLimit(0), [salary], day8, SALARY_DAY,
    );

    expect(summary.remainingAllowance).toBe(0);
    expect(summary.projectedDepletionDate).toBe('2026-08-17');
  });

  it('gives a required pace that spends exactly the remainder', () => {
    const summary = paceOn(50_000);

    expect(summary.requiredDailyPace * summary.spendDaysRemaining)
      .toBeLessThanOrEqual(summary.remainingAllowance);
    expect((summary.requiredDailyPace + 1) * summary.spendDaysRemaining)
      .toBeGreaterThan(summary.remainingAllowance);
  });
});

describe('card usage summary stays on the spend track', () => {
  it('reports current-cycle card usage separately from the bill due this cycle', () => {
    const { transactions } = referenceScenario();
    const usage = calculateCardPaymentSummary('2026-08', transactions, [CREDIT_CARD], SALARY_DAY);

    expect(usage.totalCardUsage).toBe(300_000);
  });
});
