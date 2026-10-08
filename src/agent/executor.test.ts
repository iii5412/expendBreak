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
    expect(cafe.transactions).toEqual([expect.objectContaining({ id: 't2', payment: '카드 딥드림' })]);
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
