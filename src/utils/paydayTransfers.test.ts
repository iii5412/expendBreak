import { describe, expect, it } from 'vitest';
import type { BankAccount, RecurringOccurrence, RecurringTemplate } from '../types';
import type { MonthlyCardSettlement } from './cardPayments';
import { buildPaydayTransferGroups } from './paydayTransfers';

const account: BankAccount = {
  id: 'bill-account', bankName: '신한', accountName: '결제 통장', accountNumber: '123', accountHolder: '홍길동',
  balance: 0, createdAt: '', updatedAt: '',
};
const template = (extra: Partial<RecurringTemplate>): RecurringTemplate => ({
  id: 'rent', type: 'expense', name: '월세', defaultAmount: 500_000, categoryId: 'housing', counterparty: '임대인',
  frequency: 'monthly', dayOfMonth: 10, holidayPolicy: 'fixed_date', postingMode: 'confirm', allowAmountChange: true,
  paymentMethodType: 'account', accountId: account.id, startDate: '2026-01-01', nextDueDate: '2026-09-10',
  active: true, createdAt: '', updatedAt: '', ...extra,
});
const occurrence = (extra: Partial<RecurringOccurrence>): RecurringOccurrence => ({
  id: 'rent-2026-09', templateId: 'rent', occurrenceKey: 'rent-2026-09', scheduledDate: '2026-09-10',
  expectedAmount: 500_000, status: 'scheduled', paymentMethodType: 'account', accountId: account.id,
  typeSnapshot: 'expense', createdAt: '', updatedAt: '', ...extra,
});
const card = (extra: Partial<MonthlyCardSettlement>): MonthlyCardSettlement => ({
  cardId: 'card-1', cardName: '생활 카드', cardCompany: '신한카드', linkedAccountId: account.id,
  paymentDate: '2026-09-15', usageYearMonth: '2026-08', usageStartDate: '2026-08-01', usageEndDate: '2026-08-31',
  hasStatementWindow: true, amount: 300_000, estimatedAmount: 300_000, source: 'confirmed', status: 'scheduled', ...extra,
});

describe('buildPaydayTransferGroups', () => {
  it('combines account-paid fixed costs and card bills under the withdrawal account', () => {
    const [group] = buildPaydayTransferGroups({
      recurringOccurrences: [occurrence({})], recurringTemplates: [template({})], bankAccounts: [account], cardSettlements: [card({})],
    });
    expect(group).toMatchObject({ accountId: account.id, label: '결제 통장 · 신한', pendingAmount: 800_000 });
    expect(group.items.map(item => [item.kind, item.amount, item.selectable])).toEqual([
      ['recurring', 500_000, true],
      ['card_settlement', 300_000, true],
    ]);
  });

  it('does not list card-paid fixed costs twice', () => {
    const groups = buildPaydayTransferGroups({
      recurringOccurrences: [occurrence({ paymentMethodType: 'card', cardId: 'card-1' })],
      recurringTemplates: [template({ paymentMethodType: 'card', accountId: null, cardId: 'card-1' })],
      bankAccounts: [account], cardSettlements: [card({})],
    });
    expect(groups.flatMap(group => group.items)).toHaveLength(1);
    expect(groups[0].pendingAmount).toBe(300_000);
  });

  it('keeps zero-value and unlinked card bills visible but not selectable', () => {
    const groups = buildPaydayTransferGroups({
      recurringOccurrences: [], recurringTemplates: [], bankAccounts: [account],
      cardSettlements: [card({ amount: 0 }), card({ cardId: 'card-2', cardName: '미연결', linkedAccountId: null, amount: 10_000 })],
    });
    const items = groups.flatMap(group => group.items);
    expect(items.map(item => [item.label, item.selectable])).toEqual([
      ['미연결 카드대금', false],
      ['생활 카드 카드대금', false],
    ]);
  });
});
