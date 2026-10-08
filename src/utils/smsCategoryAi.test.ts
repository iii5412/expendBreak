import { describe, expect, it } from 'vitest';
import type { Category } from '../types';
import { applySmsCategorySuggestions } from './smsCategoryAi';
import type { SmsReviewCandidate } from './smsImport';

const category = (id: string, type: 'income' | 'expense' = 'expense', active = true): Category => ({ id, name: id, type, icon: '', color: '', active });
const categories = [category('etc_expense'), category('delivery_food'), category('dining_out'), category('old', 'expense', false), category('salary', 'income')];
const candidate = (merchant: string, suggestedCategoryId: string, kind: 'approval' | 'cancellation' = 'approval') => ({
  kind, merchant, suggestedCategoryId, fingerprint: merchant, amount: 1000, localDate: '2026-10-08', occurredAt: '', issuer: null,
  cardLast4: null, approvalCode: null, installmentMonths: null, messageIds: [merchant], matchedCardId: null,
}) as SmsReviewCandidate;

describe('SMS category suggestions', () => {
  const suggestions = new Map([
    ['땡겨요', { categoryId: 'delivery_food', confidence: 0.9 }],
    ['애매한가게', { categoryId: 'dining_out', confidence: 0.4 }],
    ['예전가게', { categoryId: 'old', confidence: 0.95 }],
    ['스타벅스', { categoryId: 'delivery_food', confidence: 0.99 }],
  ]);

  it('replaces only the fallback category, and only with a confident active expense category', () => {
    const result = applySmsCategorySuggestions([
      candidate('땡겨요', 'etc_expense'),
      candidate('애매한가게', 'etc_expense'),
      candidate('예전가게', 'etc_expense'),
      candidate('스타벅스', 'dining_out'),
      candidate('땡겨요', 'etc_expense', 'cancellation'),
    ], categories, suggestions);
    expect(result.map(item => item.suggestedCategoryId)).toEqual(['delivery_food', 'etc_expense', 'etc_expense', 'dining_out', 'etc_expense']);
  });
});
