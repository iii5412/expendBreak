import { describe, expect, it } from 'vitest';
import { calculateMonthSummary, getAccountingPeriod } from './calculations';
import { calculateFutureCommitments } from './futureCommitments';
import { isTransactionInPeriod, summarizeHistory } from './history';
import { spendingConclusion, spendingUsageLabel } from './spendingStatus';
import { buildCashflowTimeline } from './cashflowTimeline';
import { hasConfirmedBalance } from './accountBalances';
import { findDuplicateTransactionGroups, retainedPlanSummary } from './dataReview';
import type { BankAccount, Budget, PaymentCard, RecurringOccurrence, RecurringTemplate, Transaction } from '../types';

const now = new Date('2026-09-07T14:13:00+09:00');
const template = (extra: Partial<RecurringTemplate> = {}): RecurringTemplate => ({
  id: 'gas', name: '가스비', type: 'expense', categoryId: 'etc', counterparty: '', defaultAmount: 10040,
  frequency: 'monthly', dayOfMonth: 10, holidayPolicy: 'fixed_date', postingMode: 'confirm',
  allowAmountChange: true, paymentMethodType: 'account', active: true, startDate: '2026-01-01',
  nextDueDate: '2026-09-10', createdAt: '', updatedAt: '', ...extra,
});
const occurrence = (extra: Partial<RecurringOccurrence> = {}): RecurringOccurrence => ({
  id: 'occ', templateId: 'gas', occurrenceKey: 'gas_2026-09-10', scheduledDate: '2026-09-10',
  expectedAmount: 12000, actualAmount: null, status: 'needs_confirmation', typeSnapshot: 'expense',
  paymentMethodType: 'account', createdAt: '', updatedAt: '', ...extra,
});
const transaction = (extra: Partial<Transaction> = {}): Transaction => ({
  id: 'tx', type: 'expense', amount: 447660, localDate: '2026-09-07', occurredAt: '',
  categoryId: 'etc', merchant: '상점', memo: '', source: 'manual', createdAt: '', updatedAt: '', ...extra,
});
const budget: Budget = { yearMonth: '2026-09', totalLimit: 1800000, thresholds: [.7,.85,1], createdAt: '', updatedAt: '' };
const card: PaymentCard = { id: 'card', cardName: '카드', cardCompany: '카드사', cardType: 'credit', billingDay: 10, createdAt: '', updatedAt: '' };

describe('diagnostic audit regressions', () => {
  it('uses saved monthly amounts and skips over template defaults', () => {
    const rows = [occurrence(), occurrence({ id: 'oct', occurrenceKey: 'gas_2026-10-10', scheduledDate: '2026-10-10', status: 'skipped' })];
    const future = calculateFutureCommitments('2026-09', [], [template()], rows, [], 10, 3);
    expect(future.months.map(month => month.accountFixed)).toEqual([12000, 0, 10040]);
  });
  it('counts actual recurring postings once instead of the occurrence and default', () => {
    const tx = transaction({ amount: 13000, recurringTemplateId: 'gas', recurringOccurrenceKey: 'gas_2026-09-10', localDate: '2026-09-10', paymentMethodType: 'account' });
    const row = occurrence({ status: 'posted', transactionId: 'tx', actualAmount: 13000 });
    expect(calculateFutureCommitments('2026-09', [tx], [template()], [row], [], 10, 1).months[0].accountFixed).toBe(13000);
  });
  it('does not restore a moved monthly plan at its master due date', () => {
    const row = occurrence({ scheduledDate: '2026-09-25', expectedAmount: 12000 });
    expect(calculateFutureCommitments('2026-09', [], [template()], [row], [], 10, 1).months[0].accountFixed).toBe(12000);
  });
  it('fills only missing weekly dates while respecting a skipped week', () => {
    const weekly = template({ frequency: 'weekly', startDate: '2026-09-10', defaultAmount: 1000 });
    const row = occurrence({ status: 'skipped' });
    expect(calculateFutureCommitments('2026-09', [], [weekly], [row], [], 10, 1).months[0].accountFixed).toBe(4000);
  });
  it('retains loaded archived plans consistently across months but creates no new ones', () => {
    const retiredCard = template({ id: 'retired-card', archivedAt: '2026-08-19', paymentMethodType: 'card', cardId: card.id, defaultAmount: 7890 });
    const retiredAccount = template({ id: 'retired-account', archivedAt: '2026-08-19', defaultAmount: 35000 });
    const rows = [
      occurrence({ templateId: retiredCard.id, id: 'old-card', occurrenceKey: 'old-card', scheduledDate: '2026-10-12', expectedAmount: 7890, paymentMethodType: 'card', cardId: card.id }),
      occurrence({ templateId: retiredAccount.id, id: 'old-account', occurrenceKey: 'old-account', scheduledDate: '2026-10-12', expectedAmount: 35000 }),
    ];
    const templates = [retiredCard, retiredAccount];
    const august = calculateFutureCommitments('2026-08', [], templates, rows, [card], 10);
    const september = calculateFutureCommitments('2026-09', [], templates, rows, [card], 10);
    expect(august.months.find(m => m.yearMonth === '2026-11')).toEqual(september.months.find(m => m.yearMonth === '2026-11'));
    expect(september.months.find(m => m.yearMonth === '2026-11')?.cardSettlement).toBe(7890);
    expect(september.months.find(m => m.yearMonth === '2026-10')?.accountFixed).toBe(35000);
    expect(september.months.find(m => m.yearMonth === '2026-12')?.total).toBe(0);
    expect(calculateFutureCommitments('2026-09', [], [], rows, [card], 10).months.every(m => m.total === 0)).toBe(true);
  });
  it('closes a past spending month without inventing an extra day or depletion forecast', () => {
    const summary = calculateMonthSummary('2026-08', [transaction({ localDate: '2026-08-15' })], [], budget, [], new Date(2026, 8, 10), 10);
    expect(summary.spendDaysRemaining).toBe(0);
    expect(summary.spendPeriodStatus).toBe('closed');
    expect(summary.projectedDepletionDate).toBeNull();
    expect(summary.forecastVariableSpend).toBe(447660);
    expect(summary.dailySafeAllowance).toBe(0);
    expect(spendingConclusion(summary)).toContain('마감');
    expect(getAccountingPeriod('2026-09', 10, now).daysRemaining).toBe(30);
  });
  it('shows no-capacity independently of a configured-limit usage percentage', () => {
    const summary = calculateMonthSummary('2026-09', [transaction({ localDate: '2026-09-10' })], [], budget, [], now, 10);
    expect(summary.budgetUsagePercent).toBeNull();
    expect(summary.configuredLimitUsagePercent).toBe(24.9);
    expect(summary.alertLevel).toBe('danger');
    expect(spendingUsageLabel(summary)).toBe('가용 재원 없음');
    expect(spendingConclusion(summary)).not.toContain('999');
  });
  it('separates a funding deficit from spending already recorded', () => {
    const salary = template({ id: 'salary', type: 'income', defaultAmount: 6325830 });
    const row = occurrence({ templateId: 'salary', expectedAmount: 6325830, typeSnapshot: 'income' });
    const summary = calculateMonthSummary('2026-09', [transaction({ localDate: '2026-09-10' })], [row], budget, [salary], now, 10, { cardSettlementOutflow: 7010566, reserveUnmaterializedTemplates: false });
    expect(summary.fundingShortfall).toBe(684736);
    expect(summary.confirmedVariableExpenses).toBe(447660);
  });
  it('reconciles the home consumption month with history including installment rounds', () => {
    const period = getAccountingPeriod('2026-09', 10, now);
    const purchase = transaction();
    const installment = transaction({ id: 'installment', localDate: '2026-07-20', amount: 300000, installment: { totalMonths: 3, currentRound: 1, baseYearMonth: '2026-08' } });
    expect(isTransactionInPeriod(purchase, 'period', now, period)).toBe(false);
    const rows = [purchase, installment].filter(tx => isTransactionInPeriod(tx, 'spending', now, period));
    const summary = calculateMonthSummary('2026-09', [purchase, installment], [], budget, [], now, 10);
    expect(summarizeHistory(rows, new Set(), '2026-09').expense).toBe(summary.confirmedVariableExpenses);
  });
  it('keeps settlements, transfers, and replaced history out of consumption totals', () => {
    const totals = summarizeHistory([
      transaction({ amount: 100 }),
      transaction({ amount: 300, role: 'card_settlement' }),
      transaction({ amount: 250, recurringTemplateId: 'old-bill' }),
      transaction({ amount: 200, role: 'transfer' }),
    ], new Set(['old-bill']));
    expect(totals).toEqual({ income: 0, expense: 100, settlement: 300, transfer: 200, replaced: 250, net: -100 });
  });
  it('accepts explicitly confirmed zero balances but not legacy default zero', () => {
    const account = { id: 'acc', balance: 0, balanceAsOf: '2026-09-07', balanceConfirmed: true } as BankAccount;
    expect(hasConfirmedBalance(account)).toBe(true);
    expect(hasConfirmedBalance({ ...account, balanceConfirmed: undefined })).toBe(false);
    const timeline = buildCashflowTimeline(getAccountingPeriod('2026-09', 10, now), [], [], [], [account], { yearMonth: '2026-09', cards: [], totalAmount: 0, linkedAccountTotal: 0, unlinkedAmount: 0 }, 0, now);
    expect(timeline.hasStartingBalance).toBe(true);
  });
  it('flags potential duplicates without altering records or excluding legitimate repeated payments', () => {
    const rows = [transaction({ id: 'a' }), transaction({ id: 'b' })];
    const original = JSON.stringify(rows);
    expect(findDuplicateTransactionGroups(rows)).toHaveLength(1);
    expect(JSON.stringify(rows)).toBe(original);
    expect(summarizeHistory(rows).expense).toBe(895320);
  });
  it('reports retained plan months by salary cycle and excludes closed rows', () => {
    const rows = [occurrence(), occurrence({ id: 'oct', scheduledDate: '2026-10-05' }), occurrence({ id: 'done', status: 'posted' })];
    expect(retainedPlanSummary(rows, 10)).toEqual({ count: 2, months: ['2026-09'], amount: 24000 });
  });
});
