import { describe, expect, it } from 'vitest';
import { QuickEntry, Transaction } from '../types';
import { suggestQuickEntryCandidates } from './quickEntrySuggestions';

const TODAY = new Date(2026, 7, 14);

function tx(overrides: Partial<Transaction> & { localDate: string }): Transaction {
  return {
    id: `tx_${overrides.localDate}_${overrides.merchant ?? 'm'}_${overrides.amount ?? 0}`,
    type: 'expense',
    amount: 9000,
    occurredAt: `${overrides.localDate}T12:00:00.000Z`,
    categoryId: 'food',
    merchant: '김밥천국',
    memo: '',
    source: 'manual',
    createdAt: `${overrides.localDate}T12:00:00.000Z`,
    updatedAt: `${overrides.localDate}T12:00:00.000Z`,
    ...overrides,
  };
}

function quickEntry(overrides: Partial<QuickEntry>): QuickEntry {
  return {
    id: 'quick_1',
    label: '점심',
    type: 'expense',
    amount: 9000,
    categoryId: 'food',
    merchant: '김밥천국',
    memo: '',
    paymentMethodType: 'card',
    sortOrder: 0,
    useCount: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('suggestQuickEntryCandidates', () => {
  it('suggests a shape repeated at least three times', () => {
    const transactions = [
      tx({ localDate: '2026-08-01' }),
      tx({ localDate: '2026-08-05' }),
      tx({ localDate: '2026-08-11' }),
    ];

    const [suggestion] = suggestQuickEntryCandidates(transactions, [], { today: TODAY });

    expect(suggestion.merchant).toBe('김밥천국');
    expect(suggestion.count).toBe(3);
    expect(suggestion.fixedAmount).toBe(9000);
  });

  it('ignores a shape seen only twice', () => {
    const transactions = [tx({ localDate: '2026-08-01' }), tx({ localDate: '2026-08-05' })];

    expect(suggestQuickEntryCandidates(transactions, [], { today: TODAY })).toEqual([]);
  });

  it('reports a variable amount instead of a fixed one', () => {
    const transactions = [
      tx({ localDate: '2026-08-01', amount: 8000 }),
      tx({ localDate: '2026-08-05', amount: 9000 }),
      tx({ localDate: '2026-08-11', amount: 12000 }),
    ];

    const [suggestion] = suggestQuickEntryCandidates(transactions, [], { today: TODAY });

    expect(suggestion.fixedAmount).toBeNull();
    expect(suggestion.latestAmount).toBe(12000);
  });

  it('skips shapes already saved as a quick entry', () => {
    const transactions = [
      tx({ localDate: '2026-08-01' }),
      tx({ localDate: '2026-08-05' }),
      tx({ localDate: '2026-08-11' }),
    ];

    const saved = [quickEntry({ merchant: '김밥천국', categoryId: 'food' })];

    expect(suggestQuickEntryCandidates(transactions, saved, { today: TODAY })).toEqual([]);
  });

  it('matches merchants case-insensitively and ignores surrounding spaces', () => {
    const transactions = [
      tx({ localDate: '2026-08-01', merchant: 'Starbucks' }),
      tx({ localDate: '2026-08-05', merchant: 'starbucks ' }),
      tx({ localDate: '2026-08-11', merchant: ' STARBUCKS' }),
    ];

    const [suggestion] = suggestQuickEntryCandidates(transactions, [], { today: TODAY });

    expect(suggestion.count).toBe(3);
  });

  it('ignores transactions outside the lookback window', () => {
    const transactions = [
      tx({ localDate: '2025-01-01' }),
      tx({ localDate: '2025-01-05' }),
      tx({ localDate: '2026-08-11' }),
    ];

    expect(suggestQuickEntryCandidates(transactions, [], { today: TODAY })).toEqual([]);
  });

  it('ignores app-generated rows: recurring, settlements and installments', () => {
    const recurring = ['2026-08-01', '2026-08-05', '2026-08-11']
      .map(localDate => tx({ localDate, recurringTemplateId: 'tmpl_1' }));
    const settlements = ['2026-08-02', '2026-08-06', '2026-08-12']
      .map(localDate => tx({ localDate, merchant: '카드대금', role: 'card_settlement' }));
    const installments = ['2026-08-03', '2026-08-07', '2026-08-13'].map(localDate => tx({
      localDate,
      merchant: '노트북',
      installment: { totalMonths: 3, currentRound: 1, baseYearMonth: '2026-08' },
    }));

    const suggestions = suggestQuickEntryCandidates(
      [...recurring, ...settlements, ...installments], [], { today: TODAY },
    );

    expect(suggestions).toEqual([]);
  });

  it('ignores transactions with a blank merchant', () => {
    const transactions = ['2026-08-01', '2026-08-05', '2026-08-11']
      .map(localDate => tx({ localDate, merchant: '   ' }));

    expect(suggestQuickEntryCandidates(transactions, [], { today: TODAY })).toEqual([]);
  });

  it('ranks the most frequent shape first and honours the limit', () => {
    const often = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']
      .map(localDate => tx({ localDate, merchant: '자주가는집' }));
    const rare = ['2026-08-05', '2026-08-06', '2026-08-07']
      .map(localDate => tx({ localDate, merchant: '가끔가는집' }));

    const suggestions = suggestQuickEntryCandidates([...often, ...rare], [], { today: TODAY, limit: 1 });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].merchant).toBe('자주가는집');
  });

  it('keeps the same merchant separate when the category differs', () => {
    const food = ['2026-08-01', '2026-08-02', '2026-08-03']
      .map(localDate => tx({ localDate, merchant: '이마트', categoryId: 'food' }));
    const living = ['2026-08-04', '2026-08-05', '2026-08-06']
      .map(localDate => tx({ localDate, merchant: '이마트', categoryId: 'living' }));

    const suggestions = suggestQuickEntryCandidates([...food, ...living], [], { today: TODAY });

    expect(suggestions).toHaveLength(2);
    expect(new Set(suggestions.map(s => s.categoryId))).toEqual(new Set(['food', 'living']));
  });
});
