import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import { reconcileCardStatement, validateExtractedStatement } from './cardStatementReconcile';

const transaction = (id: string, amount: number, overrides: Partial<Transaction> = {}): Transaction => ({
  id,
  type: 'expense',
  amount,
  occurredAt: '2026-10-08T12:00:00.000Z',
  localDate: '2026-10-08',
  categoryId: 'food',
  merchant: '스타벅스',
  memo: '',
  source: 'manual',
  paymentMethodType: 'card',
  cardId: 'card-1',
  createdAt: '2026-10-08T12:00:00.000Z',
  updatedAt: '2026-10-08T12:00:00.000Z',
  ...overrides,
});

describe('card statement reconciliation', () => {
  it('accepts valid AI rows and rejects cancellation or invalid dates', () => {
    const result = validateExtractedStatement({ rows: [
      { localDate: '2026.10.08', merchant: '스타벅스', amount: 5000, kind: 'purchase', matchedTransactionId: '', matchReason: '' },
      { localDate: '2026-10-08', merchant: '스타벅스', amount: 5000, kind: 'cancel' },
      { localDate: '2026-02-30', merchant: '편의점', amount: 2000, kind: 'purchase' },
    ] });
    expect(result.rows).toEqual([{ line: 1, localDate: '2026-10-08', merchant: '스타벅스', amount: 5000, suggestedTransactionId: '', matchReason: '' }]);
    expect(result.issues).toHaveLength(2);
  });

  it('does not accept unsafe amounts or missing merchant names from AI', () => {
    const result = validateExtractedStatement({ rows: [
      { localDate: '2026-10-08', merchant: '', amount: 5000, kind: 'purchase' },
      { localDate: '2026-10-08', merchant: '카페', amount: -5000, kind: 'purchase' },
    ] });
    expect(result.rows).toHaveLength(0);
    expect(result.issues).toHaveLength(2);
  });

  it('separates existing, amount correction, new, and ambiguous rows', () => {
    const rows = [
      { line: 1, localDate: '2026-10-08', merchant: '스타벅스', amount: 5000 },
      { line: 2, localDate: '2026-10-08', merchant: '편의점', amount: 3000 },
      { line: 3, localDate: '2026-10-08', merchant: '약국', amount: 8000 },
      { line: 4, localDate: '2026-10-08', merchant: '약국', amount: 8000 },
    ];
    const matches = reconcileCardStatement(rows, [transaction('a', 5000), transaction('b', 3500, { merchant: '편의점' })], 'card-1');
    expect(matches.map(match => match.kind)).toEqual(['existing', 'correction', 'new', 'review']);
    expect(matches[1].transaction?.id).toBe('b');
  });

  it('does not correct a settlement or a transaction from another card', () => {
    const rows = [{ line: 1, localDate: '2026-10-08', merchant: '스타벅스', amount: 5500 }];
    const matches = reconcileCardStatement(rows, [
      transaction('settlement', 5000, { role: 'card_settlement' }),
      transaction('other-card', 5000, { cardId: 'card-2' }),
    ], 'card-1');
    expect(matches[0].kind).toBe('new');
  });

  it('uses a validated AI suggestion when the recorded merchant uses a different name', () => {
    const rows = [{ line: 1, localDate: '2026-10-08', merchant: '배달의민족', amount: 15000,
      suggestedTransactionId: 'known', matchReason: '같은 날의 동일 결제' }];
    const matches = reconcileCardStatement(rows, [transaction('known', 15000, { merchant: '우아한형제들' })], 'card-1');
    expect(matches[0]).toMatchObject({ kind: 'correction', transaction: { id: 'known' } });
  });
});
