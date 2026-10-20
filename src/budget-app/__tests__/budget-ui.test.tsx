import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTransactionUpdates,
  effectiveVariableLimit,
  needsLimitSetup,
  toBudgetInput,
  type BudgetAccountData,
} from '../adapter';
import { AccountBudgetView, type BudgetAccountActions } from '../AccountBudgetView';
import { accountCatalog } from '../catalog';
import { emptyLocalAccount, putLocalTemplate } from '../localAccount';
import { filterHistory, validateTransactionEdit, type TransactionEdit } from '../history';
import { QuickAddDialog } from '../QuickAddDialog';
import { TransactionEditSheet } from '../TransactionEditSheet';
import type { TemplateInput } from '../RecurringManager';
import { calculateBudget } from '../../lib/calculator';
import { configurePaydaySchedule } from '../../utils/paydaySchedule';
import {
  buildSmsExpenseTransaction,
  merchantRuleToRemember,
  prepareSmsReviewQueue,
  resolveSmsCategory,
} from '../../utils/smsImport';
import type { BudgetTransaction } from '../../types/budget';
import type { CycleBaseline, PaymentCard, QuickEntry, Transaction } from '../../types';

const now = new Date(2026, 9, 19, 12);
const stamp = '2026-10-01T00:00:00.000Z';

beforeEach(() => configurePaydaySchedule());
afterEach(() => configurePaydaySchedule());

const baseline = (livingBudget: number, yearMonth = '2026-10'): CycleBaseline => ({
  yearMonth,
  confirmedIncome: 0,
  accountFixedOutflow: 0,
  cardSettlement: 0,
  savingsReserve: 0,
  livingBudget,
  lockedAt: stamp,
  revisions: [],
  createdAt: stamp,
  updatedAt: stamp,
});
const account = (overrides: Partial<BudgetAccountData> = {}): BudgetAccountData => {
  const data = emptyLocalAccount(now);
  return {
    ...data,
    profile: { ...data.profile, onboardingCompletedAt: stamp },
    budget: { ...data.budget, totalLimit: 0 },
    ...overrides,
  };
};
const fixedTemplate = (overrides: Partial<TemplateInput>): TemplateInput => ({
  type: 'expense',
  name: '월세',
  defaultAmount: 325_000,
  categoryId: 'housing_utilities',
  counterparty: '월세',
  expenseNature: 'fixed',
  frequency: 'monthly',
  dayOfMonth: 25,
  holidayPolicy: 'fixed_date',
  postingMode: 'confirm',
  allowAmountChange: false,
  startDate: '2026-10-01',
  nextDueDate: '2026-10-25',
  active: true,
  ...overrides,
});

describe('variable expense limit fallback', () => {
  it('uses the locked living budget when no limit was typed', () => {
    const data = account({ cycleBaseline: baseline(3_516_430) });
    expect(toBudgetInput(data, now).settings.variableExpenseLimit).toBe(3_516_430);
    expect(needsLimitSetup(data, '2026-10')).toBe(false);
  });

  it('prefers the typed limit and ignores another cycle’s baseline', () => {
    const typed = account({ budget: { ...account().budget, totalLimit: 1_500_000 }, cycleBaseline: baseline(3_516_430) });
    expect(effectiveVariableLimit(typed, '2026-10')).toBe(1_500_000);
    const stale = account({ cycleBaseline: baseline(3_516_430, '2026-09') });
    expect(effectiveVariableLimit(stale, '2026-10')).toBe(0);
    expect(needsLimitSetup(stale, '2026-10')).toBe(true);
  });
});

describe('manual card bill templates', () => {
  const cards: PaymentCard[] = [
    {
      id: 'shinhan',
      cardName: '신한카드',
      cardCompany: '신한카드',
      cardType: 'credit',
      linkedAccountId: 'main',
      billingDay: 10,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  const withTemplates = (paymentCards: PaymentCard[]) => {
    let data = account({ paymentCards });
    data = putLocalTemplate(data, fixedTemplate({}), 'rent', now);
    data = putLocalTemplate(
      data,
      fixedTemplate({
        name: '신한카드',
        counterparty: '신한카드',
        defaultAmount: 2_167_483,
        paymentMethodType: 'account',
        accountId: 'main',
        dayOfMonth: 26,
        nextDueDate: '2026-10-26',
      }),
      'shinhan-manual',
      now,
    );
    return data;
  };

  it('counts a replaced card bill once, through the generated settlement only', () => {
    const withCard = toBudgetInput(withTemplates(cards), now);
    const withoutCard = toBudgetInput(withTemplates([]), now);
    expect(calculateBudget(withoutCard).fixedExpenseBudget).toBe(325_000 + 2_167_483);
    expect(calculateBudget(withCard).fixedExpenseBudget).toBe(325_000);
    expect(withCard.templates.map((t) => t.id)).toEqual(['rent']);
    expect(withCard.occurrences.every((o) => o.templateId === 'rent')).toBe(true);
  });
});

describe('budget cycle selection', () => {
  it('evaluates a finished cycle as of its last day', () => {
    const data = account();
    const past = toBudgetInput(data, now, '2026-09');
    expect(past.period).toMatchObject({ key: '2026-09', start: '2026-09-01', end: '2026-09-30' });
    expect(past.today).toBe('2026-09-30');
    expect(toBudgetInput(data, now).today).toBe('2026-10-19');
  });
});

describe('sms approval in the budget view', () => {
  const categories = ['dining_out', 'etc_expense'].map((id) => ({
    id,
    name: id,
    type: 'expense' as const,
    icon: '',
    color: '',
    active: true,
  }));
  const card = (): PaymentCard => ({
    id: 'c1',
    cardName: '신한카드',
    cardCompany: '신한카드',
    cardType: 'credit',
    cardLast4: '1234',
    createdAt: stamp,
    updatedAt: stamp,
  });
  const candidate = () =>
    prepareSmsReviewQueue(
      [
        {
          id: 'm1',
          sender: '01000000000',
          body: ['신한카드 *1234 승인', '2,000원 일시불', '10/20 08:10 메가MGC커피', '승인번호 111222'].join('\n'),
          receivedAt: new Date(2026, 9, 20, 8, 11).getTime(),
        },
      ],
      [],
      [card()],
      categories as never,
      [{ id: 'r', pattern: '메가MGC커피', categoryId: 'etc_expense', createdAt: stamp }],
    ).candidates[0];

  const actions = {} as BudgetAccountActions;
  const renderView = (sms?: Parameters<typeof AccountBudgetView>[0]['sms']) =>
    renderToStaticMarkup(
      <AccountBudgetView
        account={account({ categories: categories as never, paymentCards: [card()] })}
        actions={actions}
        isDemo={false}
        sms={sms}
      />,
    );

  it('shows the found banner and review card when candidates are waiting', () => {
    const found = candidate();
    expect(found).toMatchObject({ merchant: '메가MGC커피', suggestedCategoryId: 'dining_out' });
    const bridge = {
      candidates: [found],
      onApprove: async () => undefined,
      onDismiss: async () => undefined,
      onUpdate: () => undefined,
      onScanComplete: () => undefined,
    };
    const markup = renderView(bridge);
    expect(markup).toContain('결제 문자 1건을 찾았어요');
    expect(markup).toContain('SMS 확인 대기 1건');
    expect(markup).toContain('id="sms-review"');
    expect(markup).toContain('일회성 지출');
    expect(markup).toContain('메가MGC커피');
  });

  it('renders nothing extra without candidates', () => {
    expect(renderView({ candidates: [], onApprove: async () => undefined, onDismiss: async () => undefined, onUpdate: () => undefined, onScanComplete: () => undefined })).not.toContain('SMS 확인 대기');
    expect(renderView(undefined)).not.toContain('SMS 확인 대기');
  });

  it('turns an approved candidate into a budget-aware transaction and remembers the merchant', () => {
    const found = { ...candidate(), isOneOff: true };
    expect(buildSmsExpenseTransaction(found, 10)).toMatchObject({
      type: 'expense',
      amount: 2000,
      categoryId: 'dining_out',
      expenseNature: 'variable',
      isOneOff: true,
      budgetPeriodKey: '2026-10',
      source: 'sms',
      cardId: 'c1',
    });
    expect(merchantRuleToRemember(found)).toEqual({ pattern: '메가MGC커피', categoryId: 'dining_out' });
    expect(merchantRuleToRemember({ ...found, suggestedCategoryId: 'etc_expense' })).toBeNull();
    expect(resolveSmsCategory('메가MGC커피', categories as never, [])).toBe('dining_out');
  });
});

describe('history search, filter and edit', () => {
  const tx = (id: string, overrides: Partial<BudgetTransaction>): BudgetTransaction => ({
    id,
    localDate: '2026-10-10',
    budgetPeriodKey: '2026-10',
    type: 'expense',
    amount: 2000,
    expenseNature: 'variable',
    isOneOff: false,
    categoryId: 'dining_out',
    merchant: '메가MGC커피',
    ...overrides,
  });
  const rows = [
    tx('coffee', {}),
    tx('etc', { merchant: '타임 전자담', categoryId: 'etc_expense', localDate: '2026-10-12' }),
    tx('trip', { merchant: '병원', isOneOff: true, localDate: '2026-10-11' }),
    tx('rent', { merchant: '월세', expenseNature: 'fixed', categoryId: 'housing_utilities' }),
    tx('pay', { type: 'income', merchant: '월급', categoryId: undefined }),
  ];
  const ids = (options: Parameters<typeof filterHistory>[1]) => filterHistory(rows, options).map((t) => t.id);

  it('filters by nature and finds uncategorized rows', () => {
    expect(ids({ filter: 'etc' })).toEqual(['etc']);
    expect(ids({ filter: 'one_off' })).toEqual(['trip']);
    expect(ids({ filter: 'fixed' })).toEqual(['rent']);
    expect(ids({ filter: 'income' })).toEqual(['pay']);
    expect(ids({ filter: 'variable' })).toEqual(['etc', 'coffee']);
    expect(ids({})[0]).toBe('etc');
  });

  it('searches merchant and memo ignoring case and spaces', () => {
    expect(ids({ query: '메가 mgc' })).toEqual(['coffee']);
    expect(ids({ query: '전자담', filter: 'etc' })).toEqual(['etc']);
    expect(ids({ query: '없는가게' })).toEqual([]);
  });

  const stored = (overrides: Partial<Transaction> = {}): Transaction => ({
    id: 'sms-1',
    type: 'expense',
    amount: 2000,
    occurredAt: '2026-10-10T01:00:00.000Z',
    localDate: '2026-10-10',
    categoryId: 'etc_expense',
    merchant: '메가MGC커피',
    memo: '',
    source: 'sms',
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  });
  const edit = (overrides: Partial<TransactionEdit> = {}): TransactionEdit => ({
    merchant: '메가MGC커피',
    amount: 2000,
    localDate: '2026-10-10',
    categoryId: 'etc_expense',
    isOneOff: false,
    memo: '',
    saveRule: false,
    ...overrides,
  });

  it('sends only what changed so untouched amount and date stay unprotected', () => {
    expect(buildTransactionUpdates(stored(), edit(), 10)).toEqual({});
    expect(buildTransactionUpdates(stored(), edit({ categoryId: 'dining_out', isOneOff: true }), 10)).toEqual({
      categoryId: 'dining_out',
      isOneOff: true,
    });
  });

  it('re-assigns the cycle when the date moves, except for recurring-linked rows', () => {
    const moved = buildTransactionUpdates(stored(), edit({ localDate: '2026-10-05' }), 10);
    expect(moved).toMatchObject({ localDate: '2026-10-05', budgetPeriodKey: '2026-09' });
    const recurring = buildTransactionUpdates(
      stored({ recurringOccurrenceKey: 'tpl_2026-10-12' }),
      edit({ localDate: '2026-10-05' }),
      10,
    );
    expect(recurring).not.toHaveProperty('budgetPeriodKey');
  });

  it('does not turn a fixed bill into a one-off', () => {
    expect(buildTransactionUpdates(stored({ expenseNature: 'fixed' }), edit({ isOneOff: true }), 10)).toEqual({});
  });

  it('rejects amounts and dates the storage layer would refuse', () => {
    expect(validateTransactionEdit(edit({ amount: 0 }))).toContain('1원');
    expect(validateTransactionEdit(edit({ amount: 12.5 }))).toContain('1원');
    expect(validateTransactionEdit(edit({ localDate: '' }))).toContain('날짜');
    expect(validateTransactionEdit(edit())).toBeNull();
  });

  it('renders the edit sheet with every editable field and a delete button', () => {
    const markup = renderToStaticMarkup(
      <TransactionEditSheet
        transaction={tx('etc', { merchant: '타임 전자담', categoryId: 'etc_expense' })}
        categories={[
          { id: 'dining_out', label: '외식', icon: '🍽️' },
          { id: 'etc_expense', label: '기타', icon: '🧾' },
        ]}
        onSave={() => undefined}
        onDelete={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(markup).toContain('value="타임 전자담"');
    expect(markup).toContain('value="2000"');
    expect(markup).toContain('value="2026-10-10"');
    expect(markup).toContain('일회성 지출');
    expect(markup).toContain('수정 저장');
    expect(markup).toContain('이 거래 삭제');
    // No category change yet, so the auto-classify offer stays hidden.
    expect(markup).not.toContain('자동 분류');
  });
});

describe('one-tap entries from the account', () => {
  const categories = [
    { id: 'dining_out', name: '외식', type: 'expense' as const, icon: '', color: '', active: true },
    { id: 'delivery_food', name: '배달', type: 'expense' as const, icon: '', color: '', active: true },
  ];
  const saved = (overrides: Partial<QuickEntry>): QuickEntry => ({
    id: 'q1',
    label: '메가커피',
    type: 'expense',
    amount: 2000,
    categoryId: 'dining_out',
    merchant: '메가커피',
    memo: '',
    paymentMethodType: 'card',
    cardId: 'c1',
    sortOrder: 0,
    useCount: 0,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  });

  it('turns saved entries into fixed-amount chips that remember the card', () => {
    const { quickEntries } = accountCatalog(categories as never, { quickEntries: [saved({})], useDefaults: true });
    expect(quickEntries).toHaveLength(1);
    expect(quickEntries[0]).toMatchObject({
      merchant: '메가커피',
      defaultAmount: 2000,
      cardId: 'c1',
      paymentMethodType: 'card',
    });
    expect(quickEntries[0].label).toContain('2,000원');
  });

  it('falls back to habits, then to demo chips only for an empty account', () => {
    const suggestion = {
      merchant: '메가커피',
      categoryId: 'dining_out',
      type: 'expense' as const,
      count: 40,
      fixedAmount: 2000,
      latestAmount: 2000,
      lastUsedDate: '2026-10-19',
    };
    const habits = accountCatalog(categories as never, { suggestions: [suggestion], useDefaults: true }).quickEntries;
    expect(habits.map((q) => q.merchant)).toEqual(['메가커피']);
    expect(accountCatalog(categories as never, { useDefaults: false }).quickEntries).toEqual([]);
    expect(accountCatalog(categories as never, { useDefaults: true }).quickEntries.length).toBeGreaterThan(0);
  });

  it('lets a fixed-amount chip be tapped before any amount is typed', () => {
    const { quickEntries, categories: catalogCategories } = accountCatalog(categories as never, {
      quickEntries: [saved({}), saved({ id: 'q2', label: '배민', merchant: '배민', amount: null, categoryId: 'delivery_food' })],
    });
    const markup = renderToStaticMarkup(
      <QuickAddDialog
        input={toBudgetInput(account(), now)}
        categories={catalogCategories}
        quickEntries={quickEntries}
        isDemo={false}
        onSave={() => undefined}
        onClose={() => undefined}
        pendingSmsCount={3}
        onReviewSms={() => undefined}
      />,
    );
    const chips = markup.match(/<button[^>]*>(?:(?!<\/button>).)*<\/button>/g)!.filter((b) => /메가커피 2,000원|배민 ·/.test(b));
    expect(chips).toHaveLength(2);
    expect(chips[0]).not.toContain('disabled');
    expect(chips[1]).toContain('disabled');
    expect(markup).toContain('인식된 결제 문자 3건 검토하기');
  });
});

describe('add dialog agent', () => {
  const dialog = (agentSlot?: Parameters<typeof QuickAddDialog>[0]['agentSlot']) =>
    renderToStaticMarkup(
      <QuickAddDialog
        input={toBudgetInput(account(), now)}
        categories={[{ id: 'dining_out', label: '외식', icon: '🍽️' }]}
        quickEntries={[]}
        isDemo={false}
        onSave={() => undefined}
        onClose={() => undefined}
        ai={{ categories: [], saveRule: async () => undefined, classify: async () => { throw new Error('unused'); } }}
        agentSlot={agentSlot}
      />,
    );

  it('shows the agent in place of the one-sentence box', () => {
    const withAgent = dialog(() => <p>에이전트 자리</p>);
    expect(withAgent).toContain('에이전트 자리');
    expect(withAgent).not.toContain('한 문장으로 기록하기');
  });

  it('keeps the one-sentence box when no agent is wired', () => {
    expect(dialog()).toContain('한 문장으로 기록하기');
  });
});
