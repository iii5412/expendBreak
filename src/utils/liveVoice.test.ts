import { describe, expect, it } from 'vitest';
import { BankAccount, Budget, Category, Transaction } from '../types';
import {
  createAssistantFinancialSnapshot,
  createLiveVoiceResult,
  searchTransactionsForAssistant,
} from './liveVoice';

const categories: Category[] = [
  { id: 'food', name: '식비', type: 'expense', icon: 'food', color: '#fff', active: true },
  { id: 'etc_expense', name: '기타 지출', type: 'expense', icon: 'etc', color: '#fff', active: true },
  { id: 'salary', name: '급여', type: 'income', icon: 'salary', color: '#fff', active: true },
  { id: 'etc_income', name: '기타 수입', type: 'income', icon: 'etc', color: '#fff', active: true },
];

const transaction = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx-1',
  type: 'expense',
  amount: 52_000,
  occurredAt: '2026-08-10T12:00:00.000Z',
  localDate: '2026-08-10',
  categoryId: 'food',
  merchant: '이마트',
  memo: '장보기',
  source: 'manual',
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-10T12:00:00.000Z',
  ...overrides,
});

describe('GPT live finance helpers', () => {
  it('never assigns an income category to an expense draft', () => {
    const result = createLiveVoiceResult({
      type: 'expense',
      amount: 10_000,
      date: '2026-08-11',
      merchant: '편의점',
      category_name: '급여',
      payment_method: 'card',
      spoken_summary: '편의점에서 만 원 썼어',
    }, {
      categories,
      merchantRules: [],
      bankAccounts: [],
      paymentCards: [],
      defaultDate: '2026-08-11',
    });

    expect(result.type).toBe('expense');
    expect(categories.find(category => category.id === result.suggestedCategoryId)?.type).toBe('expense');
    expect(result.needsConfirmation).toBe(true);
  });

  it('uses a merchant rule and resolves a named card without exposing card data', () => {
    const result = createLiveVoiceResult({
      type: 'expense',
      amount: 24_900,
      merchant: '배민',
      payment_method: 'card',
      card_name: '생활 카드',
      spoken_summary: '배민에서 24900원 생활 카드로 결제했어',
    }, {
      categories,
      merchantRules: [{ id: 'rule-1', pattern: '배민', categoryId: 'food', createdAt: '2026-08-01' }],
      bankAccounts: [],
      paymentCards: [{
        id: 'card-1',
        cardName: '생활 카드',
        cardCompany: '신한카드',
        cardType: 'credit',
        createdAt: '2026-08-01',
        updatedAt: '2026-08-01',
      }],
      defaultDate: '2026-08-11',
    });

    expect(result.suggestedCategoryId).toBe('food');
    expect(result.suggestedCardId).toBe('card-1');
    expect(result.amount).toBe(24_900);
  });

  it('returns deterministic financial facts without account numbers', () => {
    const accounts: BankAccount[] = [{
      id: 'account-1',
      bankName: '신한',
      accountName: '생활비',
      accountNumber: '110-123-456789',
      accountHolder: '홍길동',
      balance: 1_200_000,
      balanceAsOf: '2026-08-11',
      createdAt: '2026-08-01',
      updatedAt: '2026-08-11',
    }];
    const budget: Budget = {
      yearMonth: '2026-08',
      totalLimit: 1_000_000,
      categoryLimits: {},
      thresholds: [0.7, 0.85, 1],
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    };

    const snapshot = createAssistantFinancialSnapshot({
      transactions: [transaction({})],
      categories,
      bankAccounts: accounts,
      budget,
      recurringOccurrences: [],
      recurringTemplates: [],
      now: new Date(2026, 7, 11),
    });

    expect(snapshot.확정지출).toBe(52_000);
    expect(snapshot.남은예산).toBe(948_000);
    expect(snapshot.수동계좌잔액합계).toBe(1_200_000);
    expect(JSON.stringify(snapshot)).not.toContain('110-123-456789');
  });

  it('limits and totals searched transactions', () => {
    const result = searchTransactionsForAssistant([
      transaction({ id: 'food-1', amount: 10_000 }),
      transaction({ id: 'food-2', amount: 20_000, merchant: '배민' }),
      transaction({ id: 'income-1', type: 'income', categoryId: 'salary', amount: 3_000_000 }),
    ], categories, { type: 'expense', category_name: '식비', limit: 10 });

    expect(result.조회건수).toBe(2);
    expect(result.합계).toBe(30_000);
  });
});
