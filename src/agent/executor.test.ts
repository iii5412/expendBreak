import { describe, expect, it } from 'vitest';
import type { BankAccount, Budget, Category, PaymentCard, RecurringOccurrence, RecurringTemplate, Transaction } from '../types';
import { executeAgentTool, type AgentDataContext } from './executor';
import { AGENT_TOOLS } from './tools';

const stamp = '2026-10-01T00:00:00.000Z';
const categories: Category[] = [
  { id: 'food', name: '식비', type: 'expense', icon: '', color: '', active: true },
  { id: 'cafe', name: '카페', type: 'expense', icon: '', color: '', active: true },
  { id: 'salary', name: '급여', type: 'income', icon: '', color: '', active: true },
  { id: 'old', name: '예전', type: 'expense', icon: '', color: '', active: false },
];
const account: BankAccount = {
  id: 'acc1', bankName: '국민', accountName: '생활비', accountNumber: '123-456-789012', accountHolder: '홍길동',
  balance: 500000, createdAt: stamp, updatedAt: stamp,
};
const card: PaymentCard = { id: 'card1', cardName: '딥드림', cardCompany: '신한카드', cardType: 'credit', cardLast4: '1234', createdAt: stamp, updatedAt: stamp };
const tx = (id: string, localDate: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id, type: 'expense', amount, occurredAt: `${localDate}T12:00:00.000Z`, localDate, categoryId: 'food',
  merchant: `가게${id}`, memo: '', source: 'manual', createdAt: stamp, updatedAt: stamp, ...extra,
});
const template: RecurringTemplate = {
  id: 'tpl1', name: '통신비', type: 'expense', amount: 55000, categoryId: 'food', dayOfMonth: 15,
  frequency: 'monthly', active: true, createdAt: stamp, updatedAt: stamp,
} as unknown as RecurringTemplate;
const occurrence = (id: string, extra: Partial<RecurringOccurrence> = {}): RecurringOccurrence => ({
  id, templateId: 'tpl1', occurrenceKey: `tpl1-${id}`, scheduledDate: '2026-10-15', expectedAmount: 55000,
  plannedAmount: 55000, amountStatus: 'suggested', status: 'scheduled', createdAt: stamp, updatedAt: stamp, ...extra,
});

function context(extra: Partial<AgentDataContext> = {}): AgentDataContext {
  const occurrences = [occurrence('occ1'), occurrence('occ2', { status: 'posted' }), occurrence('projected_x', { projected: true })];
  return {
    transactions: [
      tx('t1', '2026-10-03', 12000, { categoryId: 'food', merchant: '김밥천국' }),
      tx('t2', '2026-10-05', 5800, { categoryId: 'cafe', merchant: '스타벅스', paymentMethodType: 'card', cardId: 'card1' }),
      tx('t3', '2026-09-20', 30000, { categoryId: 'food', merchant: '마트' }),
      tx('t4', '2026-10-06', 55000, { recurringOccurrenceKey: 'tpl1-occ2', merchant: '통신비' }),
    ],
    categories,
    bankAccounts: [account],
    paymentCards: [card],
    budget: { yearMonth: '2026-10', totalLimit: 600000, thresholds: [0.7, 0.85, 1], createdAt: stamp, updatedAt: stamp } as Budget,
    recurringOccurrences: occurrences,
    allRecurringOccurrences: occurrences,
    recurringTemplates: [template],
    monthStartDay: 1,
    now: new Date('2026-10-08T03:00:00.000Z'),
    ...extra,
  };
}

describe('agent tool schemas', () => {
  it('meet OpenAI strict mode: every property required, nullable enums allow null', () => {
    for (const tool of AGENT_TOOLS) {
      const schema = tool.parameters as { properties: Record<string, { type: unknown; enum?: unknown[] }>; required: string[]; additionalProperties: boolean };
      expect(schema.additionalProperties).toBe(false);
      expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
      for (const property of Object.values(schema.properties)) {
        if (Array.isArray(property.type) && property.type.includes('null') && property.enum) {
          expect(property.enum).toContain(null);
        }
      }
    }
  });
});

describe('agent read tools', () => {
  it('searches by text and period, newest first, with totals', () => {
    const { output } = executeAgentTool('search_transactions', { from: '2026-10-01', to: '2026-10-31', text: null, type: 'expense', categoryId: null, minAmount: null, maxAmount: null, limit: null }, context());
    expect(output).toMatchObject({ matchedCount: 3, matchedTotal: 72800 });
    expect((output as { transactions: Array<{ id: string }> }).transactions.map(item => item.id)).toEqual(['t4', 't2', 't1']);

    const cafe = executeAgentTool('search_transactions', JSON.stringify({ text: '스타 벅스' }), context()).output as { transactions: Array<{ id: string; payment: string }> };
    expect(cafe.transactions).toEqual([expect.objectContaining({ id: 't2', payment: '카드 신한카드 딥드림' })]);
  });

  it('groups totals by category', () => {
    const { output } = executeAgentTool('summarize_transactions', { from: '2026-10-01', to: '2026-10-31', type: null, groupBy: 'category' }, context());
    expect(output).toMatchObject({ total: 72800, groups: [{ key: '식비', amount: 67000, count: 2 }, { key: '카페', amount: 5800, count: 1 }] });
  });

  it('never exposes account numbers, holders or card digits', () => {
    const text = JSON.stringify([
      executeAgentTool('get_reference_data', {}, context()).output,
      executeAgentTool('get_overview', {}, context()).output,
    ]);
    expect(text).not.toContain('123-456-789012');
    expect(text).not.toContain('홍길동');
    expect(text).not.toContain('1234');
  });

  it('opens only known screens', () => {
    expect(executeAgentTool('open_screen', { screen: 'history' }, context())).toMatchObject({ navigate: 'history' });
    expect(executeAgentTool('open_screen', { screen: 'admin' }, context()).navigate).toBeUndefined();
  });
});

describe('agent write proposals', () => {
  it('builds an add proposal without saving anything', () => {
    const result = executeAgentTool('propose_add_transaction', {
      type: 'expense', amount: 5800, localDate: '2026-10-07', merchant: '스타벅스', categoryId: 'cafe', memo: null,
      paymentMethodType: 'card', accountId: null, cardId: 'card1',
    }, context());
    expect(result.output).toMatchObject({ status: 'awaiting_user_approval' });
    expect(result.proposal?.action).toMatchObject({
      kind: 'add_transaction',
      draft: { type: 'expense', amount: 5800, categoryId: 'cafe', paymentMethodType: 'card', cardId: 'card1', source: 'ai' },
    });
  });

  it('refuses categories of the wrong type, inactive ones and unknown cards', () => {
    const base = { type: 'expense', amount: 1000, localDate: '2026-10-07', merchant: 'x', memo: null, paymentMethodType: null, accountId: null, cardId: null };
    expect(executeAgentTool('propose_add_transaction', { ...base, categoryId: 'salary' }, context()).proposal).toBeUndefined();
    expect(executeAgentTool('propose_add_transaction', { ...base, categoryId: 'old' }, context()).proposal).toBeUndefined();
    expect(executeAgentTool('propose_add_transaction', { ...base, categoryId: 'food', paymentMethodType: 'card', cardId: 'nope' }, context()).proposal).toBeUndefined();
    expect(executeAgentTool('propose_add_transaction', { ...base, categoryId: 'food', amount: 0 }, context()).proposal).toBeUndefined();
  });

  it('records only the changed fields and their previous values', () => {
    const result = executeAgentTool('propose_update_transaction', {
      transactionId: 't1', amount: 12000, localDate: null, merchant: null, categoryId: 'cafe', memo: null,
      paymentMethodType: null, accountId: null, cardId: null,
    }, context());
    expect(result.proposal?.action).toEqual({
      kind: 'update_transaction', transactionId: 't1', expectedUpdatedAt: stamp,
      changes: { categoryId: 'cafe' }, previous: { categoryId: 'food' },
    });
  });

  it('keeps recurring-linked transactions on the recurring screen', () => {
    const update = executeAgentTool('propose_update_transaction', {
      transactionId: 't4', amount: 60000, localDate: null, merchant: null, categoryId: null, memo: null,
      paymentMethodType: null, accountId: null, cardId: null,
    }, context());
    expect(update.proposal).toBeUndefined();
    expect(executeAgentTool('propose_delete_transaction', { transactionId: 't4' }, context()).proposal).toBeUndefined();
    expect(executeAgentTool('propose_delete_transaction', { transactionId: 't1' }, context()).proposal?.action.kind).toBe('delete_transaction');
  });

  it('allows recurring actions only on prepared, open rows', () => {
    expect(executeAgentTool('propose_complete_recurring', { occurrenceId: 'occ1', amount: null, paidOn: null }, context()).proposal?.action)
      .toEqual({ kind: 'complete_recurring', occurrenceId: 'occ1', amount: null, paidOn: null });
    expect(executeAgentTool('propose_complete_recurring', { occurrenceId: 'occ2', amount: null, paidOn: null }, context()).proposal).toBeUndefined();
    expect(executeAgentTool('propose_skip_recurring', { occurrenceId: 'projected_x' }, context()).proposal).toBeUndefined();
    expect(executeAgentTool('propose_set_recurring_amount', { occurrenceId: 'occ1', amount: 61000 }, context()).proposal?.action)
      .toEqual({ kind: 'set_recurring_amount', occurrenceId: 'occ1', amount: 61000 });
  });

  it('answers unknown tools with an error instead of throwing', () => {
    expect(executeAgentTool('drop_database', {}, context()).output).toEqual({ error: '알 수 없는 도구입니다: drop_database' });
  });
});

describe('bulk update and criterion lookup', () => {
  it('proposes one card for many transactions and skips rows already matching', async () => {
    const result = executeAgentTool('propose_bulk_update_transactions', {
      transactionIds: ['t1', 't3', 't2'], categoryId: 'food', merchant: null, paymentMethodType: null, accountId: null, cardId: null,
    }, context());
    expect(result.output).toMatchObject({ status: 'awaiting_user_approval', count: 1, alreadyMatching: 2 });
    expect(result.proposal?.action).toEqual({
      kind: 'bulk_update_transactions',
      items: [{ transactionId: 't2', expectedUpdatedAt: stamp, changes: { categoryId: 'food' }, previous: { categoryId: 'cafe' } }],
    });
  });

  it('refuses a bulk change that does not fit one of the transactions', () => {
    const result = executeAgentTool('propose_bulk_update_transactions', {
      transactionIds: ['t1', 't2'], categoryId: 'salary', merchant: null, paymentMethodType: null, accountId: null, cardId: null,
    }, context());
    expect(result.proposal).toBeUndefined();
  });

  it('groups transactions by merchant probability and sums each transaction once', async () => {
    const { prepareCriterionLookup, finishCriterionLookup } = await import('./executor');
    const ctx = context({
      transactions: [
        tx('a', '2026-09-05', 20000, { merchant: '쿠팡이츠' }),
        tx('b', '2026-09-12', 37000, { merchant: '쿠팡잇츠' }),
        tx('c', '2026-09-13', 25500, { merchant: '교촌치킨' }),
        tx('d', '2026-09-14', 9000, { merchant: '이마트' }),
        tx('e', '2026-10-01', 15000, { merchant: '쿠팡이츠' }),
      ],
    });
    const lookup = prepareCriterionLookup({ criterion: '음식 배달 주문', from: '2026-09-01', to: '2026-09-30', type: null, cardId: null, accountId: null }, ctx);
    if (typeof lookup === 'string') throw new Error(lookup);
    expect(lookup.merchants.sort()).toEqual(['교촌치킨', '이마트', '쿠팡이츠', '쿠팡잇츠']);
    const result = finishCriterionLookup(lookup, new Map([['쿠팡이츠', 0.9], ['쿠팡잇츠', 0.9], ['교촌치킨', 0.57], ['이마트', 0.1]]), ctx);
    expect(result.matched).toMatchObject({ count: 2, total: 57000, transactionIds: ['a', 'b'] });
    expect(result.unsure).toMatchObject({ count: 1, total: 25500, merchants: [{ merchant: '교촌치킨', probability: 0.57 }] });
    expect(result.excluded).toEqual({ count: 1, merchantCount: 1 });
  });
});

describe('card and living filters', () => {
  const second: PaymentCard = { ...card, id: 'card2', cardName: '체크', cardLast4: '5678' };
  const other: PaymentCard = { ...card, id: 'card3', cardName: '생활', cardCompany: '현대카드', cardLast4: '9999' };
  const ctx = () => context({
    paymentCards: [card, second, other],
    transactions: [
      tx('a', '2026-10-03', 12000, { categoryId: 'food', paymentMethodType: 'card', cardId: 'card1' }),
      tx('b', '2026-10-04', 8000, { categoryId: 'food', paymentMethodType: 'card', cardId: 'card2' }),
      tx('c', '2026-10-05', 5000, { categoryId: 'cafe', paymentMethodType: 'card', cardId: 'card1' }),
      tx('d', '2026-10-06', 9000, { categoryId: 'food', paymentMethodType: 'card', cardId: 'card3' }),
      tx('e', '2026-10-07', 55000, { categoryId: 'food', paymentMethodType: 'card', cardId: 'card1', recurringTemplateId: 'tpl1' }),
    ],
  });

  it('lists one category paid with every card of a company', () => {
    const output = executeAgentTool('search_transactions', { categoryId: 'food', card: '신한카드', livingOnly: true }, ctx()).output as {
      matchedCount: number; matchedTotal: number; transactions: Array<{ id: string; payment: string }>; filters: { cards: string[] };
    };
    expect(output.transactions.map(item => item.id)).toEqual(['b', 'a']);
    expect(output.matchedTotal).toBe(20000);
    expect(output.transactions[1].payment).toBe('카드 신한카드 딥드림');
    expect(output.filters.cards).toEqual(['신한카드 딥드림', '신한카드 체크']);
  });

  it('summarizes one card by category', () => {
    const output = executeAgentTool('summarize_transactions', { groupBy: 'category', card: 'card1' }, ctx()).output as {
      total: number; groups: Array<{ key: string; amount: number }>;
    };
    expect(output.total).toBe(72000);
    expect(output.groups).toEqual([{ key: '식비', amount: 67000, count: 2 }, { key: '카페', amount: 5000, count: 1 }]);
  });

  it('reports an unknown card instead of returning nothing', () => {
    expect(executeAgentTool('search_transactions', { card: '롯데' }, ctx()).output).toMatchObject({ error: expect.stringContaining('롯데') });
  });
});
