import { describe, expect, it } from 'vitest';
import { PaymentCard, RecurringTemplate } from '../types';
import {
  findManualCardSettlementCandidates,
  getDuplicateManualCardSettlementTemplateIds,
} from './cardSettlementPlans';

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

  it('replaces an account transfer named exactly after its linked card', () => {
    const loose = template({ id: 'loose', name: '신한카드', counterparty: '' });
    const candidates = findManualCardSettlementCandidates([loose], [card], {
      cardSettlementAmounts: { shinhan: 320_000 },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ templateId: 'loose', cardId: 'shinhan', status: 'replaced' });
    expect(getDuplicateManualCardSettlementTemplateIds([loose], [card], {
      cardSettlementAmounts: { shinhan: 320_000 },
    })).toEqual(new Set(['loose']));
  });

  it('replaces an explicitly named card bill when only one card uses the account', () => {
    const generic = template({ id: 'generic', name: '카드대금', counterparty: '' });

    expect(getDuplicateManualCardSettlementTemplateIds([generic], [card]))
      .toEqual(new Set(['generic']));
  });

  it('leaves a same-account expense alone when the amount is nothing like the bill', () => {
    const rent = template({ id: 'rent', name: '월세 카드자동이체', counterparty: '임대인' });
    expect(findManualCardSettlementCandidates([rent], [card], {
      cardSettlementAmounts: { shinhan: 900_000 },
    })).toHaveLength(0);
  });

  it('honours an explicit confirmation over any heuristic', () => {
    const confirmed = template({
      id: 'confirmed', name: '월 정산', counterparty: '',
      cardSettlementCardId: 'shinhan', cardSettlementReviewedAt: '2026-08-12T00:00:00.000Z',
    });
    expect(getDuplicateManualCardSettlementTemplateIds([confirmed], [card])).toEqual(new Set(['confirmed']));
  });

  it('stops suggesting once the user says it is a separate expense', () => {
    const dismissed = template({
      id: 'dismissed', cardSettlementCardId: null,
      cardSettlementReviewedAt: '2026-08-12T00:00:00.000Z',
    });
    expect(findManualCardSettlementCandidates([dismissed], [card])).toHaveLength(0);
    expect(getDuplicateManualCardSettlementTemplateIds([dismissed], [card]).size).toBe(0);
  });
});
