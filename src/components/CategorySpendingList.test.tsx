import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CategorySpendingList, paymentOf } from './CategorySpendingList';
import { getCategoryBreakdown, getCategoryBreakdownEntries } from '../utils/calculations';
import { BankAccount, PaymentCard, Transaction } from '../types';

const stamp = '2026-10-01T00:00:00.000Z';
const tx = (id: string, localDate: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id, type: 'expense', amount, occurredAt: `${localDate}T12:00:00.000Z`, localDate, categoryId: 'food',
  merchant: `가게${id}`, memo: '', source: 'manual', createdAt: stamp, updatedAt: stamp, ...extra,
});
const categories = {
  food: { name: '식비', color: '#f00', icon: '', type: 'expense' as const },
  cafe: { name: '카페', color: '#0f0', icon: '', type: 'expense' as const },
};
const shinhan: PaymentCard = { id: 'c1', cardName: '딥드림', cardCompany: '신한카드', cardType: 'credit', createdAt: stamp, updatedAt: stamp };
const shinhanCheck: PaymentCard = { ...shinhan, id: 'c2', cardName: '체크' };
const account: BankAccount = { id: 'a1', bankName: '국민', accountName: '생활비', balance: 0, createdAt: stamp, updatedAt: stamp } as BankAccount;

describe('category spending detail', () => {
  const transactions = [
    tx('1', '2026-10-03', 12000, { cardId: 'c1', paymentMethodType: 'card' }),
    tx('2', '2026-10-04', 8000, { cardId: 'c2', paymentMethodType: 'card' }),
    tx('3', '2026-10-05', 5000, { categoryId: 'cafe' }),
    tx('4', '2026-10-06', 300000, { installment: { totalMonths: 3, currentRound: 1, baseYearMonth: '2026-10' } }),
    tx('5', '2026-10-07', 55000, { recurringTemplateId: 'rent' }),
    tx('6', '2026-09-20', 7000),
  ];

  it('lists entries that add up to each category total', () => {
    const options = { variableOnly: true, monthStartDay: 1 };
    const entries = getCategoryBreakdownEntries('2026-10', transactions, categories, options);
    for (const item of getCategoryBreakdown('2026-10', transactions, categories, options)) {
      const sum = entries.filter(entry => entry.categoryId === item.categoryId).reduce((total, entry) => total + entry.amount, 0);
      expect(sum).toBe(item.amount);
    }
    expect(entries.find(entry => entry.transaction.id === '4')).toMatchObject({ amount: 100000, installmentRound: 1 });
    expect(entries.map(entry => entry.transaction.id)).not.toContain('5');
  });

  it('groups every card of one company under one filter', () => {
    const cards = new Map([[shinhan.id, shinhan], [shinhanCheck.id, shinhanCheck]]);
    const accounts = new Map([[account.id, account]]);
    expect(paymentOf(transactions[0], cards, accounts)).toEqual(paymentOf(transactions[1], cards, accounts));
    expect(paymentOf(tx('x', '2026-10-01', 1, { paymentMethodType: 'account', accountId: 'a1' }), cards, accounts).label).toBe('국민 생활비');
  });

  it('renders categories as buttons, collapsed until tapped', () => {
    const markup = renderToStaticMarkup(
      <CategorySpendingList
        items={[{ categoryId: 'food', name: '식비', value: 120000, color: '#f00' }]}
        entries={[]}
      />,
    );
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('식비');
  });
});
