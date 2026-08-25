import { describe, expect, it } from 'vitest';
import { BankAccount, Budget, Category, Transaction } from '../types';
import { createFinanceChatContext } from './financeChat';

const categories: Category[] = [
  { id: 'food', name: '식비', type: 'expense', icon: 'food', color: '#fff', active: true },
  { id: 'salary', name: '급여', type: 'income', icon: 'salary', color: '#fff', active: true },
];

const budget: Budget = {
  yearMonth: '2026-08', totalLimit: 500_000, thresholds: [0.7, 0.85, 1],
  createdAt: '2026-08-01', updatedAt: '2026-08-01',
};

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx', type: 'expense', amount: 12_000, occurredAt: '2026-08-20T12:00:00.000Z',
    localDate: '2026-08-20', categoryId: 'food', merchant: '동네식당', memo: '점심',
    source: 'manual', createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  };
}

describe('finance chat context', () => {
  it('builds deterministic monthly facts and excludes settlement duplication', () => {
    const context = createFinanceChatContext({
      transactions: [
        transaction({ id: 'aug-1', amount: 12_000 }),
        transaction({ id: 'aug-2', amount: 8_000 }),
        transaction({ id: 'settlement', amount: 500_000, role: 'card_settlement' }),
        transaction({ id: 'jul-income', type: 'income', categoryId: 'salary', amount: 3_000_000, localDate: '2026-07-25' }),
      ],
      categories,
      bankAccounts: [],
      paymentCards: [],
      budget,
      recurringOccurrences: [],
      recurringTemplates: [],
      now: new Date('2026-08-25T03:00:00.000Z'),
    });

    expect(context.최근12개월달력월요약[0]).toMatchObject({ 월: '2026-08', 지출: 20_000 });
    expect(context.최근거래).toHaveLength(3);
    expect(context.최근거래.some(item => item.금액 === 500_000)).toBe(false);
  });

  it('never includes account numbers, receipt OCR, or voice transcripts', () => {
    const account: BankAccount = {
      id: 'account', bankName: '신한', accountName: '생활비', accountNumber: '110-123-456789',
      accountHolder: '홍길동', balance: 100_000, createdAt: '2026-08-01', updatedAt: '2026-08-01',
    };
    const context = createFinanceChatContext({
      transactions: [transaction({
        receipt: { id: 'r', lineItems: [], rawText: '민감한 OCR 원문', ocrConfidence: 1, scannedAt: '2026-08-20' },
        voiceRecord: { transcript: '민감한 음성 원문', durationMs: 1, mimeType: 'audio/webm', confidence: 1, modelUsed: 'x', fallbackUsed: false, recordedAt: '2026-08-20' },
      })],
      categories,
      bankAccounts: [account],
      paymentCards: [],
      budget,
      recurringOccurrences: [],
      recurringTemplates: [],
    });
    const serialized = JSON.stringify(context);

    expect(serialized).not.toContain('110-123-456789');
    expect(serialized).not.toContain('민감한 OCR 원문');
    expect(serialized).not.toContain('민감한 음성 원문');
  });
});
