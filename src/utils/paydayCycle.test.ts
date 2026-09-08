import { describe, expect, it } from 'vitest';
import { calculateMonthSummary, getAccountingPeriod, getCategoryBreakdown, getCurrentYearMonth } from './calculations';
import { calculateCardPaymentSummary, calculateMonthlyCardSettlementSummary } from './cardPayments';
import { isTransactionInPeriod, summarizeHistory } from './history';
import { buildCycleClosingReport } from './cycleClosing';
import { createFinanceChatContext } from './financeChat';
import type { Budget, CycleBaseline, PaymentCard, Transaction } from '../types';

const now = new Date(2026, 8, 7, 12);
const budget: Budget = { yearMonth: '2026-08', totalLimit: 100000, thresholds: [.7,.85,1], createdAt: '', updatedAt: '' };
const card: PaymentCard = { id: 'credit', cardName: '카드', cardCompany: '카드사', cardType: 'credit', billingDay: 10, createdAt: '', updatedAt: '' };
const tx = (localDate: string, amount: number, method: Transaction['paymentMethodType'] = 'card'): Transaction => ({
  id: localDate, type: 'expense', localDate, amount, paymentMethodType: method, cardId: method === 'card' ? card.id : null,
  categoryId: 'food', merchant: '', memo: '', source: 'manual', occurredAt: '', createdAt: '', updatedAt: '',
});
const transactions = [tx('2026-08-09', 100), tx('2026-08-10', 200, 'account'), tx('2026-08-31', 400), tx('2026-09-01', 800), tx('2026-09-09', 1600), tx('2026-09-10', 3200), tx('2026-09-30', 6400), tx('2026-10-01', 12800)];

describe('payday spending and calendar card billing remain independent', () => {
  it('assigns both boundaries once, with matching home, history, categories and closing totals', () => {
    const august = calculateMonthSummary('2026-08', transactions, [], budget, [], now, 10);
    const september = calculateMonthSummary('2026-09', transactions, [], budget, [], now, 10);
    expect(august).toMatchObject({ spendPeriodStartDate: '2026-08-10', spendPeriodEndDate: '2026-09-09', confirmedVariableExpenses: 3000, spendPeriodStatus: 'active', spendDaysRemaining: 3 });
    expect(september).toMatchObject({ spendPeriodStartDate: '2026-09-10', spendPeriodEndDate: '2026-10-09', confirmedVariableExpenses: 22400, spendPeriodStatus: 'upcoming', spendDaysPassed: 0, spendDaysRemaining: 30 });
    const period = getAccountingPeriod('2026-08', 10, now);
    const history = transactions.filter(t => isTransactionInPeriod(t, 'spending', now, period));
    expect(history.map(t => t.localDate)).toEqual(['2026-08-10', '2026-08-31', '2026-09-01', '2026-09-09']);
    expect(summarizeHistory(history).expense).toBe(august.confirmedVariableExpenses);
    expect(getCategoryBreakdown('2026-08', transactions, {}, { variableOnly: true, monthStartDay: 10 })[0].amount).toBe(3000);
    const baseline: CycleBaseline = { yearMonth: '2026-08', confirmedIncome: 100000, accountFixedOutflow: 0, cardSettlement: 0, savingsReserve: 0, livingBudget: 100000, lockedAt: '', revisions: [], createdAt: '', updatedAt: '' };
    expect(buildCycleClosingReport('2026-08', baseline, transactions, [], [], 10, now)?.actualSpend).toBe(3000);
  });

  it('includes September 1 in August living expenses but only in the October 10 card bill', () => {
    const purchase = tx('2026-09-01', 800);
    expect(calculateMonthSummary('2026-08', [purchase], [], budget, [], now, 10).confirmedVariableExpenses).toBe(800);
    expect(calculateMonthSummary('2026-09', [purchase], [], budget, [], now, 10).confirmedVariableExpenses).toBe(0);
    expect(calculateMonthlyCardSettlementSummary('2026-09', [purchase], [card], 10).totalAmount).toBe(0);
    expect(calculateMonthlyCardSettlementSummary('2026-10', [purchase], [card], 10).cards[0]).toMatchObject({ paymentDate: '2026-10-10', usageStartDate: '2026-09-01', usageEndDate: '2026-09-30', amount: 800 });
    const usage = calculateCardPaymentSummary('2026-09', transactions, [card], 1);
    expect(usage.creditCards[0]).toMatchObject({ totalAmount: 12000, estimatedPaymentDate: '2026-10-10' });
    expect(calculateMonthlyCardSettlementSummary('2026-10', transactions, [card], 10).totalAmount).toBe(12000);
  });

  it('switches the current cycle on payday, including year and leap-month boundaries', () => {
    expect(getCurrentYearMonth(10, new Date(2026, 8, 9, 23, 59))).toBe('2026-08');
    expect(getCurrentYearMonth(10, new Date(2026, 8, 10))).toBe('2026-09');
    expect(getCurrentYearMonth(10, new Date(2027, 0, 9))).toBe('2026-12');
    expect(getAccountingPeriod('2028-02', 10, new Date(2028, 2, 9))).toMatchObject({ endDate: '2028-03-09', daysInMonth: 29, daysRemaining: 1 });
    expect(calculateMonthSummary('2026-08', [], [], budget, [], new Date(2026, 8, 10), 10)).toMatchObject({ spendPeriodStatus: 'closed', spendDaysRemaining: 0, dailySafeAllowance: 0 });
  });

  it('gives AI the same payday periods while identifying calendar card usage separately', () => {
    const context = createFinanceChatContext({ transactions: [tx('2026-09-01', 800)], categories: [], bankAccounts: [], paymentCards: [card], budget, recurringOccurrences: [], recurringTemplates: [], monthStartDay: 10, now });
    expect(context.최근12개월급여주기요약[0]).toMatchObject({ 월: '2026-08', 시작일: '2026-08-10', 종료일: '2026-09-09', 지출: 800 });
    expect(context.현재재무요약.사용한용돈).toBe(800);
    expect(context.현재재무요약.생활비기간).toEqual({ 시작일: '2026-08-10', 종료일: '2026-09-09' });
  });
});
