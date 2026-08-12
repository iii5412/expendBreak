import { describe, expect, it } from 'vitest';
import { PaymentCard, RecurringTemplate } from '../types';
import { getDuplicateManualCardSettlementTemplateIds } from './cardSettlementPlans';

const now = '2026-08-11T00:00:00.000Z';
const card: PaymentCard = {
  id: 'shinhan', cardName: '신한카드', cardCompany: '신한카드', cardType: 'credit',
  linkedAccountId: 'saemaeul', billingDay: 15, createdAt: now, updatedAt: now,
};
const template = (overrides: Partial<RecurringTemplate>): RecurringTemplate => ({
  id: 'manual-card-bill', type: 'expense', name: '신한카드 대금', defaultAmount: 300_000,
  categoryId: 'etc_expense', counterparty: '신한카드', frequency: 'monthly', dayOfMonth: 15,
  holidayPolicy: 'fixed_date', postingMode: 'confirm', allowAmountChange: true,
  paymentMethodType: 'account', accountId: 'saemaeul', startDate: '2026-01-01',
  nextDueDate: '2026-09-15', active: true, createdAt: now, updatedAt: now, ...overrides,
});

describe('manual card settlement duplicate detection', () => {
  it('replaces a manual card bill tied to the same settlement account', () => {
    expect(getDuplicateManualCardSettlementTemplateIds([template({})], [card])).toEqual(new Set(['manual-card-bill']));
  });

  it('does not hide an unrelated fixed expense or another account', () => {
    expect(getDuplicateManualCardSettlementTemplateIds([
      template({ id: 'rent', name: '월세', counterparty: '임대인' }),
      template({ id: 'other-account', accountId: 'other' }),
    ], [card]).size).toBe(0);
  });
});
