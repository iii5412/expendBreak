import type {
  BankAccount, Budget, Category, PaymentCard, PaymentMethodType, RecurringOccurrence, RecurringTemplate, Transaction,
} from '../types';
import { createAssistantFinancialSnapshot } from '../utils/liveVoice';
import { getAccountingPeriod, getCurrentYearMonth, getLocalDateString, getYearMonthForDate } from '../utils/calculations';
import { resolveRecurringAmount } from '../utils/recurringAmounts';
import { AGENT_SCREENS, AGENT_TOOL_KINDS, type AgentScreen } from './tools';

/**
 * Runs Agent tools against the data the app already holds. Pure: reads never
 * touch storage, and write tools only build a proposal that the user approves
 * in the UI before anything is saved.
 *
 * Everything returned in `output` goes to the model, so it never contains
 * account numbers, holders, card numbers or raw SMS/receipt text.
 */

export interface AgentDataContext {
  transactions: Transaction[];
  categories: Category[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  budget: Budget;
  /** Current-cycle rows as the app shows them (may include projected rows). */
  recurringOccurrences: RecurringOccurrence[];
  allRecurringOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  monthStartDay: number;
  now?: Date;
}

type TransactionDraft = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;
type PaymentChanges = Pick<Transaction, 'paymentMethodType' | 'accountId' | 'cardId'>;

export interface TransactionChange {
  transactionId: string;
  expectedUpdatedAt: string;
  changes: Partial<Transaction>;
  previous: Partial<Transaction>;
}

export type AgentProposalAction =
  | { kind: 'add_transaction'; draft: TransactionDraft }
  | { kind: 'update_transaction'; transactionId: string; expectedUpdatedAt: string; changes: Partial<Transaction>; previous: Partial<Transaction> }
  | { kind: 'bulk_update_transactions'; items: TransactionChange[] }
  | { kind: 'delete_transaction'; transactionId: string; expectedUpdatedAt: string }
  | { kind: 'set_recurring_amount'; occurrenceId: string; amount: number }
  | { kind: 'complete_recurring'; occurrenceId: string; amount: number | null; paidOn: string | null }
  | { kind: 'skip_recurring'; occurrenceId: string; previousStatus: RecurringOccurrence['status'] };

export interface AgentProposal {
  id: string;
  title: string;
  details: Array<{ label: string; value: string }>;
  action: AgentProposalAction;
}

export interface AgentToolResult {
  output: unknown;
  proposal?: AgentProposal;
  navigate?: AgentScreen;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 10_000_000_000;
const krw = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;
const clean = (value: unknown, max: number) => String(value ?? '')
  .replace(/[\u0000-\u001F\u007F]/g, ' ')
  .trim()
  .slice(0, max);
const fail = (error: string): AgentToolResult => ({ output: { error } });
const isNormal = (transaction: Transaction) => !transaction.role || transaction.role === 'normal';

let proposalCounter = 0;
const proposalId = () => `p${Date.now().toString(36)}${(proposalCounter++).toString(36)}`;

function args(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const int = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null);

function names(ctx: AgentDataContext) {
  const categories = new Map(ctx.categories.map(category => [category.id, category]));
  const accounts = new Map(ctx.bankAccounts.map(account => [account.id, account]));
  const cards = new Map(ctx.paymentCards.map(card => [card.id, card]));
  const templates = new Map(ctx.recurringTemplates.map(template => [template.id, template]));
  const paymentLabel = (item: { paymentMethodType?: PaymentMethodType; accountId?: string | null; cardId?: string | null }) => {
    if (item.paymentMethodType === 'account') {
      const account = item.accountId ? accounts.get(item.accountId) : null;
      return account ? `계좌 ${account.bankName} ${account.accountName}` : '계좌';
    }
    if (item.paymentMethodType === 'card') {
      const card = item.cardId ? cards.get(item.cardId) : null;
      if (!card) return '카드';
      // The company is how people name a card ("신한카드로 쓴 것"); the name alone is often a nickname.
      return card.cardName.includes(card.cardCompany) ? `카드 ${card.cardName}` : `카드 ${card.cardCompany} ${card.cardName}`;
    }
    if (item.paymentMethodType === 'cash') return '현금';
    return item.paymentMethodType === 'other' ? '기타' : '미지정';
  };
  return { categories, accounts, cards, templates, paymentLabel };
}

function describeTransaction(transaction: Transaction, ctx: AgentDataContext) {
  const { categories, paymentLabel } = names(ctx);
  return {
    id: transaction.id,
    date: transaction.localDate,
    type: transaction.type,
    amount: Math.round(transaction.amount),
    merchant: clean(transaction.merchant, 80),
    category: categories.get(transaction.categoryId)?.name ?? '미분류',
    categoryId: transaction.categoryId,
    memo: clean(transaction.memo, 120) || undefined,
    payment: paymentLabel(transaction),
    tags: transaction.tags?.length ? transaction.tags.slice(0, 5) : undefined,
    fromRecurring: Boolean(transaction.recurringOccurrenceKey) || undefined,
    role: isNormal(transaction) ? undefined : transaction.role,
  };
}

/** Validates a payment choice against the user's accounts and cards. */
function resolvePayment(raw: Record<string, unknown>, ctx: AgentDataContext): PaymentChanges | string | null {
  const type = str(raw.paymentMethodType);
  if (!type) return null;
  if (!['account', 'card', 'cash', 'other'].includes(type)) return '결제수단은 account, card, cash, other 중 하나여야 합니다.';
  if (type === 'account') {
    const accountId = str(raw.accountId);
    if (!accountId || !ctx.bankAccounts.some(account => account.id === accountId)) return '계좌 결제는 get_reference_data의 accountId가 필요합니다.';
    return { paymentMethodType: 'account', accountId, cardId: null };
  }
  if (type === 'card') {
    const cardId = str(raw.cardId);
    if (!cardId || !ctx.paymentCards.some(card => card.id === cardId)) return '카드 결제는 get_reference_data의 cardId가 필요합니다.';
    return { paymentMethodType: 'card', cardId, accountId: null };
  }
  return { paymentMethodType: type as PaymentMethodType, accountId: null, cardId: null };
}

function checkCategory(categoryId: string, type: Transaction['type'], ctx: AgentDataContext): string | null {
  const category = ctx.categories.find(item => item.id === categoryId);
  if (!category) return '없는 카테고리입니다. get_reference_data로 id를 확인하세요.';
  if (!category.active) return `'${category.name}' 카테고리는 사용 중지 상태입니다.`;
  if (category.type !== type) return `'${category.name}'은 ${category.type === 'income' ? '수입' : '지출'} 카테고리라 이 거래에 쓸 수 없습니다.`;
  return null;
}

function checkAmount(amount: number | null, allowZero = false): string | null {
  if (amount === null) return '금액이 필요합니다.';
  if (amount < (allowZero ? 0 : 1) || amount > MAX_AMOUNT) return allowZero ? '금액은 0원 이상이어야 합니다.' : '금액은 1원 이상이어야 합니다.';
  return null;
}

function occurrenceView(occurrence: RecurringOccurrence, ctx: AgentDataContext) {
  const template = ctx.recurringTemplates.find(item => item.id === occurrence.templateId);
  const resolved = resolveRecurringAmount(occurrence, ctx.transactions);
  return {
    id: occurrence.id,
    name: clean(template?.name, 60) || '정기 항목',
    type: occurrence.typeSnapshot ?? template?.type ?? 'expense',
    scheduledDate: occurrence.scheduledDate,
    amount: resolved.amount,
    amountStatus: resolved.status,
    status: occurrence.status,
    planNotPrepared: occurrence.projected || undefined,
  };
}

function findOccurrence(id: string, ctx: AgentDataContext) {
  return ctx.allRecurringOccurrences.find(item => item.id === id)
    ?? ctx.recurringOccurrences.find(item => item.id === id)
    ?? null;
}

function occurrenceProblem(occurrence: RecurringOccurrence | null): string | null {
  if (!occurrence) return '없는 고정 항목입니다. list_recurring으로 id를 확인하세요.';
  if (occurrence.projected || occurrence.id.startsWith('projected_')) {
    return '이 주기는 아직 계획이 준비되지 않았습니다. 고정지출 화면에서 "미리 준비하기"를 먼저 해야 합니다.';
  }
  if (occurrence.status === 'posted') return '이미 완료 처리된 항목입니다.';
  if (occurrence.status === 'skipped') return '이번 주기에서 제외된 항목입니다.';
  return null;
}

function transactionTarget(id: unknown, ctx: AgentDataContext) {
  const transactionId = str(id);
  const transaction = transactionId ? ctx.transactions.find(item => item.id === transactionId) : undefined;
  return transaction ?? null;
}

const squash = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, '');

/**
 * Card, account, payment-type and living-only filters shared by the search
 * and summary tools. A card can be named by id, company or name, so
 * "신한카드" covers every Shinhan card.
 */
function paymentFilter(a: Record<string, unknown>, ctx: AgentDataContext) {
  const card = str(a.card);
  const accountId = str(a.accountId);
  const method = ['account', 'card', 'cash', 'other'].includes(String(a.paymentMethodType)) ? String(a.paymentMethodType) : null;
  const livingOnly = a.livingOnly === true;
  let cardIds: Set<string> | null = null;
  if (card) {
    const needle = squash(card);
    const matches = ctx.paymentCards.filter(item => item.id === card
      || [item.cardName, item.cardCompany].some(name => {
        const value = squash(name);
        return value.length > 0 && (value.includes(needle) || needle.includes(value));
      }));
    if (matches.length === 0) return `'${clean(card, 40)}'에 해당하는 카드가 없습니다. get_reference_data로 카드 목록을 확인하세요.`;
    cardIds = new Set(matches.map(item => item.id));
  }
  if (accountId && !ctx.bankAccounts.some(account => account.id === accountId)) {
    return '없는 계좌입니다. get_reference_data로 id를 확인하세요.';
  }
  const { cards } = names(ctx);
  return {
    test: (item: Transaction) => (!cardIds || Boolean(item.cardId && cardIds.has(item.cardId)))
      && (!accountId || item.accountId === accountId)
      && (!method || item.paymentMethodType === method)
      && (!livingOnly || !item.recurringTemplateId),
    applied: {
      cards: cardIds ? [...cardIds].map(id => `${cards.get(id)?.cardCompany ?? ''} ${cards.get(id)?.cardName ?? ''}`.trim()) : undefined,
      accountId: accountId ?? undefined,
      paymentMethodType: method ?? undefined,
      livingOnly: livingOnly || undefined,
    },
  };
}

const MAX_BULK = 100;
const FIELD_LABEL: Partial<Record<keyof Transaction, string>> = {
  amount: '금액', localDate: '날짜', merchant: '사용처', memo: '메모', categoryId: '카테고리', paymentMethodType: '결제수단',
};

function showField(ctx: AgentDataContext) {
  const { categories, paymentLabel } = names(ctx);
  return (key: keyof Transaction, source: Partial<Transaction>) => {
    if (key === 'amount') return krw(Number(source.amount));
    if (key === 'categoryId') return categories.get(String(source.categoryId))?.name ?? '미분류';
    if (key === 'paymentMethodType') return paymentLabel(source);
    return String(source[key] ?? '') || '(비어 있음)';
  };
}

/**
 * Turns requested values into the fields that actually change, with their
 * previous values for undo. Null or missing values mean "keep".
 */
function buildChanges(
  transaction: Transaction,
  a: Record<string, unknown>,
  ctx: AgentDataContext,
): Pick<TransactionChange, 'changes' | 'previous'> | string {
  const changes: Partial<Transaction> = {};
  const amount = int(a.amount);
  if (amount !== null) {
    const amountProblem = checkAmount(amount);
    if (amountProblem) return amountProblem;
    if (transaction.recurringOccurrenceKey || !isNormal(transaction)) {
      return '고정지출이나 카드대금으로 생긴 거래의 금액은 고정지출 화면에서만 바꿀 수 있습니다.';
    }
    if (amount !== transaction.amount) changes.amount = amount;
  }
  const localDate = str(a.localDate);
  if (localDate) {
    if (!DATE.test(localDate)) return 'localDate는 YYYY-MM-DD 형식이어야 합니다.';
    if (localDate !== transaction.localDate) {
      changes.localDate = localDate;
      changes.occurredAt = `${localDate}T12:00:00.000Z`;
    }
  }
  const merchant = str(a.merchant);
  if (merchant && clean(merchant, 80) !== transaction.merchant) changes.merchant = clean(merchant, 80);
  if (typeof a.memo === 'string' && clean(a.memo, 300) !== transaction.memo) changes.memo = clean(a.memo, 300);
  const categoryId = str(a.categoryId);
  if (categoryId && categoryId !== transaction.categoryId) {
    const categoryProblem = checkCategory(categoryId, transaction.type, ctx);
    if (categoryProblem) return categoryProblem;
    changes.categoryId = categoryId;
  }
  const payment = resolvePayment(a, ctx);
  if (typeof payment === 'string') return payment;
  if (payment && (payment.paymentMethodType !== transaction.paymentMethodType
    || (payment.accountId ?? null) !== (transaction.accountId ?? null)
    || (payment.cardId ?? null) !== (transaction.cardId ?? null))) {
    Object.assign(changes, payment);
  }
  const keys = Object.keys(changes) as Array<keyof Transaction>;
  const previous = Object.fromEntries(keys.map(key => [key, transaction[key] ?? null])) as Partial<Transaction>;
  return { changes, previous };
}

// --- find_by_criterion: the app asks the server per merchant name, then this
// turns the probabilities into matched / unsure / excluded transactions.

export const CRITERION_MATCH = 0.75;
export const CRITERION_EXCLUDE = 0.35;
const MAX_CRITERION_MERCHANTS = 200;

export interface CriterionLookup {
  criterion: string;
  transactions: Transaction[];
  merchants: string[];
}

const merchantKey = (value: string) => clean(value, 80) || '사용처 미입력';

/** Filters the period and lists the distinct merchant names to judge. */
export function prepareCriterionLookup(rawArgs: unknown, ctx: AgentDataContext): CriterionLookup | string {
  const a = args(rawArgs);
  const criterion = clean(a.criterion, 200);
  if (!criterion) return 'criterion이 필요합니다. 예: "음식 배달 주문"';
  const from = DATE.test(String(a.from)) ? String(a.from) : '0000-01-01';
  const to = DATE.test(String(a.to)) ? String(a.to) : '9999-12-31';
  const type = a.type === 'income' ? 'income' : 'expense';
  const cardId = str(a.cardId);
  const accountId = str(a.accountId);
  const transactions = ctx.transactions.filter(item => isNormal(item)
    && item.type === type
    && item.localDate >= from && item.localDate <= to
    && (!cardId || item.cardId === cardId)
    && (!accountId || item.accountId === accountId));
  const merchants = [...new Set(transactions.map(item => merchantKey(item.merchant)))];
  if (merchants.length === 0) return '조건에 맞는 거래가 없습니다.';
  if (merchants.length > MAX_CRITERION_MERCHANTS) return `가맹점이 ${merchants.length}곳이라 너무 많습니다. 기간을 줄여 주세요.`;
  return { criterion, transactions, merchants };
}

/** Sums by transaction id, so a transaction is never counted twice. */
export function finishCriterionLookup(lookup: CriterionLookup, probabilities: Map<string, number | null>, ctx: AgentDataContext) {
  const { categories } = names(ctx);
  const groups = { matched: [] as Transaction[], unsure: [] as Transaction[], excluded: [] as Transaction[] };
  for (const transaction of lookup.transactions) {
    const probability = probabilities.get(merchantKey(transaction.merchant));
    if (probability == null) groups.unsure.push(transaction);
    else if (probability >= CRITERION_MATCH) groups.matched.push(transaction);
    else if (probability <= CRITERION_EXCLUDE) groups.excluded.push(transaction);
    else groups.unsure.push(transaction);
  }
  const byMerchant = (items: Transaction[]) => {
    const map = new Map<string, { merchant: string; probability: number | null; count: number; total: number; categories: Set<string> }>();
    for (const item of items) {
      const key = merchantKey(item.merchant);
      const entry = map.get(key) ?? { merchant: key, probability: probabilities.get(key) ?? null, count: 0, total: 0, categories: new Set<string>() };
      entry.count += 1;
      entry.total += Math.round(item.amount);
      entry.categories.add(categories.get(item.categoryId)?.name ?? '미분류');
      map.set(key, entry);
    }
    return [...map.values()]
      .sort((left, right) => right.total - left.total)
      .map(entry => ({ ...entry, probability: entry.probability == null ? null : Math.round(entry.probability * 100) / 100, categories: [...entry.categories] }));
  };
  const sum = (items: Transaction[]) => items.reduce((total, item) => total + Math.round(item.amount), 0);
  return {
    criterion: lookup.criterion,
    matched: { count: groups.matched.length, total: sum(groups.matched), merchants: byMerchant(groups.matched), transactionIds: groups.matched.map(item => item.id) },
    unsure: { count: groups.unsure.length, total: sum(groups.unsure), merchants: byMerchant(groups.unsure), transactionIds: groups.unsure.map(item => item.id) },
    excluded: { count: groups.excluded.length, merchantCount: new Set(groups.excluded.map(item => merchantKey(item.merchant))).size },
    note: '합계는 거래 id 기준으로 한 번씩만 계산했다. unsure는 사용자에게 포함 여부를 물어볼 것.',
  };
}

export function executeAgentTool(name: string, rawArgs: unknown, ctx: AgentDataContext): AgentToolResult {
  if (!AGENT_TOOL_KINDS[name]) return fail(`알 수 없는 도구입니다: ${name}`);
  const a = args(rawArgs);
  const now = ctx.now ?? new Date();
  const today = getLocalDateString(now);
  const { categories, paymentLabel } = names(ctx);

  switch (name) {
    case 'get_overview': {
      const cycle = getCurrentYearMonth(ctx.monthStartDay, now);
      const period = getAccountingPeriod(cycle, ctx.monthStartDay, now);
      const current = ctx.recurringOccurrences.map(occurrence => occurrenceView(occurrence, ctx));
      return {
        output: {
          today,
          currentCycle: { cycle, startDate: period.startDate, endDate: period.endDate },
          summary: createAssistantFinancialSnapshot({ ...ctx, now }),
          recurring: {
            total: current.length,
            done: current.filter(item => item.status === 'posted').length,
            skipped: current.filter(item => item.status === 'skipped').length,
            pending: current.filter(item => item.status !== 'posted' && item.status !== 'skipped').length,
            planPrepared: !current.some(item => item.planNotPrepared),
          },
        },
      };
    }

    case 'get_reference_data':
      return {
        output: {
          categories: ctx.categories.filter(category => category.active).map(category => ({ id: category.id, name: category.name, type: category.type })),
          accounts: ctx.bankAccounts.map(account => ({
            id: account.id, bank: account.bankName, name: account.accountName,
            balance: Math.round(account.balance || 0), balanceAsOf: account.balanceAsOf ?? null,
          })),
          cards: ctx.paymentCards.map(card => ({ id: card.id, name: card.cardName, company: card.cardCompany, type: card.cardType })),
        },
      };

    case 'search_transactions': {
      const from = DATE.test(String(a.from)) ? String(a.from) : '0000-01-01';
      const to = DATE.test(String(a.to)) ? String(a.to) : '9999-12-31';
      const type = a.type === 'income' || a.type === 'expense' ? a.type : null;
      const text = str(a.text)?.toLowerCase().replace(/\s+/g, '') ?? null;
      const categoryId = str(a.categoryId);
      const minAmount = int(a.minAmount);
      const maxAmount = int(a.maxAmount);
      const limit = Math.max(1, Math.min(100, int(a.limit) ?? 30));
      const payment = paymentFilter(a, ctx);
      if (typeof payment === 'string') return fail(payment);
      const matched = ctx.transactions
        .filter(item => item.localDate >= from && item.localDate <= to)
        .filter(payment.test)
        .filter(item => !type || item.type === type)
        .filter(item => !categoryId || item.categoryId === categoryId)
        .filter(item => minAmount === null || item.amount >= minAmount)
        .filter(item => maxAmount === null || item.amount <= maxAmount)
        .filter(item => !text || [item.merchant, item.memo, ...(item.tags || []), categories.get(item.categoryId)?.name]
          .some(value => String(value || '').toLowerCase().replace(/\s+/g, '').includes(text)))
        .sort((left, right) => `${right.localDate}${right.createdAt}`.localeCompare(`${left.localDate}${left.createdAt}`));
      return {
        output: {
          filters: payment.applied,
          matchedCount: matched.length,
          matchedTotal: matched.reduce((sum, item) => sum + Math.round(item.amount), 0),
          shown: Math.min(limit, matched.length),
          transactions: matched.slice(0, limit).map(item => describeTransaction(item, ctx)),
        },
      };
    }

    case 'summarize_transactions': {
      const from = DATE.test(String(a.from)) ? String(a.from) : '0000-01-01';
      const to = DATE.test(String(a.to)) ? String(a.to) : '9999-12-31';
      const type = a.type === 'income' ? 'income' : 'expense';
      const groupBy = String(a.groupBy);
      const categoryId = str(a.categoryId);
      const payment = paymentFilter(a, ctx);
      if (typeof payment === 'string') return fail(payment);
      const keyOf = (item: Transaction) => {
        if (groupBy === 'category') return categories.get(item.categoryId)?.name ?? '미분류';
        if (groupBy === 'merchant') return clean(item.merchant, 60) || '사용처 미입력';
        if (groupBy === 'cycle') return getYearMonthForDate(item.localDate, ctx.monthStartDay);
        if (groupBy === 'day') return item.localDate;
        return paymentLabel(item);
      };
      const groups = new Map<string, { amount: number; count: number }>();
      let total = 0;
      ctx.transactions
        .filter(item => isNormal(item) && item.type === type && item.localDate >= from && item.localDate <= to)
        .filter(item => !categoryId || item.categoryId === categoryId)
        .filter(payment.test)
        .forEach(item => {
          const key = keyOf(item);
          const group = groups.get(key) ?? { amount: 0, count: 0 };
          group.amount += Math.round(item.amount);
          group.count += 1;
          total += Math.round(item.amount);
          groups.set(key, group);
        });
      const sorted = [...groups.entries()].sort((left, right) => (groupBy === 'cycle' || groupBy === 'day')
        ? right[0].localeCompare(left[0])
        : right[1].amount - left[1].amount);
      return {
        output: {
          type, from, to, groupBy, total,
          filters: { ...payment.applied, category: categoryId ? categories.get(categoryId)?.name ?? categoryId : undefined },
          groups: sorted.slice(0, 60).map(([key, value]) => ({ key, ...value })),
          omittedGroups: Math.max(0, sorted.length - 60),
        },
      };
    }

    case 'list_recurring': {
      const currentCycle = getCurrentYearMonth(ctx.monthStartDay, now);
      const cycle = /^\d{4}-\d{2}$/.test(String(a.cycle)) ? String(a.cycle) : currentCycle;
      const rows = cycle === currentCycle
        ? ctx.recurringOccurrences
        : (() => {
            const period = getAccountingPeriod(cycle, ctx.monthStartDay, now);
            return ctx.allRecurringOccurrences.filter(item => item.scheduledDate >= period.startDate && item.scheduledDate <= period.endDate);
          })();
      return {
        output: {
          cycle,
          items: rows
            .slice()
            .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate))
            .map(occurrence => occurrenceView(occurrence, ctx)),
        },
      };
    }

    case 'open_screen': {
      const screen = String(a.screen) as AgentScreen;
      if (!AGENT_SCREENS.includes(screen)) return fail('열 수 없는 화면입니다.');
      return { output: { opened: screen }, navigate: screen };
    }

    case 'propose_add_transaction': {
      const type = a.type === 'income' ? 'income' : a.type === 'expense' ? 'expense' : null;
      if (!type) return fail('type은 income 또는 expense여야 합니다.');
      const amount = int(a.amount);
      const amountProblem = checkAmount(amount);
      if (amountProblem) return fail(amountProblem);
      const localDate = String(a.localDate);
      if (!DATE.test(localDate)) return fail('localDate는 YYYY-MM-DD 형식이어야 합니다.');
      const categoryId = String(a.categoryId);
      const categoryProblem = checkCategory(categoryId, type, ctx);
      if (categoryProblem) return fail(categoryProblem);
      const payment = resolvePayment(a, ctx);
      if (typeof payment === 'string') return fail(payment);
      const merchant = clean(a.merchant, 80) || (type === 'income' ? '수입' : '사용처 미입력');
      const memo = clean(a.memo, 300);
      const draft: TransactionDraft = {
        type,
        amount: amount!,
        occurredAt: `${localDate}T12:00:00.000Z`,
        localDate,
        categoryId,
        merchant,
        memo,
        source: 'ai',
        aiReviewed: true,
        paymentMethodType: payment?.paymentMethodType ?? 'other',
        accountId: payment?.accountId ?? null,
        cardId: payment?.cardId ?? null,
        tags: [],
      };
      const proposal: AgentProposal = {
        id: proposalId(),
        title: `${type === 'income' ? '수입' : '지출'} 추가`,
        details: [
          { label: '날짜', value: localDate },
          { label: '사용처', value: merchant },
          { label: '금액', value: `${type === 'income' ? '+' : '-'}${krw(amount!)}` },
          { label: '카테고리', value: categories.get(categoryId)!.name },
          { label: '결제수단', value: paymentLabel(draft) },
          ...(memo ? [{ label: '메모', value: memo }] : []),
        ],
        action: { kind: 'add_transaction', draft },
      };
      return { output: { status: 'awaiting_user_approval', proposalId: proposal.id }, proposal };
    }

    case 'propose_update_transaction': {
      const transaction = transactionTarget(a.transactionId, ctx);
      if (!transaction) return fail('없는 거래입니다. search_transactions로 id를 확인하세요.');
      const built = buildChanges(transaction, a, ctx);
      if (typeof built === 'string') return fail(built);
      const keys = Object.keys(built.changes) as Array<keyof Transaction>;
      if (keys.length === 0) return fail('바뀌는 내용이 없습니다.');
      const show = showField(ctx);
      const proposal: AgentProposal = {
        id: proposalId(),
        title: '거래 수정',
        details: [
          { label: '대상', value: `${transaction.localDate} ${transaction.merchant || '사용처 미입력'} ${krw(transaction.amount)}` },
          ...keys
            .filter(key => FIELD_LABEL[key])
            .map(key => ({ label: FIELD_LABEL[key]!, value: `${show(key, { ...transaction, ...built.previous })} → ${show(key, { ...transaction, ...built.changes })}` })),
        ],
        action: { kind: 'update_transaction', transactionId: transaction.id, expectedUpdatedAt: transaction.updatedAt, ...built },
      };
      return { output: { status: 'awaiting_user_approval', proposalId: proposal.id }, proposal };
    }

    case 'propose_bulk_update_transactions': {
      const ids = Array.isArray(a.transactionIds) ? [...new Set(a.transactionIds.map(String))] : [];
      if (ids.length === 0) return fail('transactionIds가 필요합니다. search_transactions나 find_by_criterion으로 id를 찾으세요.');
      if (ids.length > MAX_BULK) return fail(`한 번에 ${MAX_BULK}건까지 바꿀 수 있습니다. 나눠서 제안하세요.`);
      // Only fields that make sense for many rows at once.
      const fields = { categoryId: a.categoryId, merchant: a.merchant, paymentMethodType: a.paymentMethodType, accountId: a.accountId, cardId: a.cardId };
      const items: TransactionChange[] = [];
      let alreadyMatching = 0;
      let total = 0;
      for (const transactionId of ids) {
        const transaction = transactionTarget(transactionId, ctx);
        if (!transaction) return fail(`없는 거래가 있습니다: ${transactionId}`);
        const built = buildChanges(transaction, fields, ctx);
        if (typeof built === 'string') return fail(`${transaction.localDate} ${transaction.merchant}: ${built}`);
        if (Object.keys(built.changes).length === 0) {
          alreadyMatching += 1;
          continue;
        }
        total += Math.round(transaction.amount);
        items.push({ transactionId, expectedUpdatedAt: transaction.updatedAt, ...built });
      }
      if (items.length === 0) return fail('모든 거래가 이미 그 값입니다. 바뀌는 내용이 없습니다.');
      const show = showField(ctx);
      const byId = new Map(ctx.transactions.map(transaction => [transaction.id, transaction]));
      const changedKeys = [...new Set(items.flatMap(item => Object.keys(item.changes) as Array<keyof Transaction>))]
        .filter(key => FIELD_LABEL[key]);
      const describeBefore = (key: keyof Transaction) => {
        const values = [...new Set(items.map(item => show(key, { ...byId.get(item.transactionId)!, ...item.previous })))];
        return `${values.slice(0, 3).join(', ')}${values.length > 3 ? ' 등' : ''}`;
      };
      const sample = items.slice(0, 5).map(item => {
        const transaction = byId.get(item.transactionId)!;
        return `${transaction.localDate.slice(5)} ${transaction.merchant || '사용처 미입력'} ${krw(transaction.amount)}`;
      });
      const proposal: AgentProposal = {
        id: proposalId(),
        title: `거래 ${items.length}건 한꺼번에 수정`,
        details: [
          { label: '대상', value: `${items.length}건 · 합계 ${krw(total)}` },
          ...changedKeys.map(key => ({ label: FIELD_LABEL[key]!, value: `${describeBefore(key)} → ${show(key, { ...byId.get(items[0].transactionId)!, ...items[0].changes })}` })),
          { label: '포함', value: `${sample.join(' / ')}${items.length > sample.length ? ` 외 ${items.length - sample.length}건` : ''}` },
        ],
        action: { kind: 'bulk_update_transactions', items },
      };
      return { output: { status: 'awaiting_user_approval', proposalId: proposal.id, count: items.length, alreadyMatching }, proposal };
    }

    case 'propose_delete_transaction': {
      const transaction = transactionTarget(a.transactionId, ctx);
      if (!transaction) return fail('없는 거래입니다. search_transactions로 id를 확인하세요.');
      if (transaction.recurringOccurrenceKey) return fail('고정지출 완료로 생긴 거래입니다. 고정지출 화면에서 완료를 취소해야 합니다.');
      if (!isNormal(transaction)) return fail('카드대금 같은 시스템 거래는 삭제할 수 없습니다.');
      const proposal: AgentProposal = {
        id: proposalId(),
        title: '거래 삭제',
        details: [
          { label: '날짜', value: transaction.localDate },
          { label: '사용처', value: transaction.merchant || '사용처 미입력' },
          { label: '금액', value: `${transaction.type === 'income' ? '+' : '-'}${krw(transaction.amount)}` },
          { label: '카테고리', value: categories.get(transaction.categoryId)?.name ?? '미분류' },
        ],
        action: { kind: 'delete_transaction', transactionId: transaction.id, expectedUpdatedAt: transaction.updatedAt },
      };
      return { output: { status: 'awaiting_user_approval', proposalId: proposal.id }, proposal };
    }

    case 'propose_set_recurring_amount': {
      const occurrence = findOccurrence(String(a.occurrenceId), ctx);
      const problem = occurrenceProblem(occurrence);
      if (problem) return fail(problem);
      const amount = int(a.amount);
      const amountProblem = checkAmount(amount, true);
      if (amountProblem) return fail(amountProblem);
      const view = occurrenceView(occurrence!, ctx);
      const proposal: AgentProposal = {
        id: proposalId(),
        title: '고정 항목 금액 확정',
        details: [
          { label: '항목', value: view.name },
          { label: '예정일', value: view.scheduledDate },
          { label: '금액', value: `${view.amount == null ? '미입력' : krw(view.amount)} → ${krw(amount!)}` },
        ],
        action: { kind: 'set_recurring_amount', occurrenceId: occurrence!.id, amount: amount! },
      };
      return { output: { status: 'awaiting_user_approval', proposalId: proposal.id }, proposal };
    }

    case 'propose_complete_recurring': {
      const occurrence = findOccurrence(String(a.occurrenceId), ctx);
      const problem = occurrenceProblem(occurrence);
      if (problem) return fail(problem);
      const view = occurrenceView(occurrence!, ctx);
      const amount = int(a.amount);
      if (amount !== null) {
        const amountProblem = checkAmount(amount);
        if (amountProblem) return fail(amountProblem);
      } else if (!view.amount || view.amount <= 0) {
        return fail('이 항목은 금액이 정해지지 않았습니다. amount를 지정하세요.');
      }
      const paidOn = str(a.paidOn);
      if (paidOn && !DATE.test(paidOn)) return fail('paidOn은 YYYY-MM-DD 형식이어야 합니다.');
      const isIncome = view.type === 'income';
      const proposal: AgentProposal = {
        id: proposalId(),
        title: `${view.name} ${isIncome ? '입금' : '납부'} 완료`,
        details: [
          { label: '항목', value: view.name },
          { label: '금액', value: krw(amount ?? view.amount!) },
          { label: '처리일', value: paidOn ?? `${today} (오늘)` },
          { label: '결과', value: '완료 처리하고 거래를 만듭니다' },
        ],
        action: { kind: 'complete_recurring', occurrenceId: occurrence!.id, amount, paidOn },
      };
      return { output: { status: 'awaiting_user_approval', proposalId: proposal.id }, proposal };
    }

    case 'propose_skip_recurring': {
      const occurrence = findOccurrence(String(a.occurrenceId), ctx);
      const problem = occurrenceProblem(occurrence);
      if (problem) return fail(problem);
      const view = occurrenceView(occurrence!, ctx);
      const proposal: AgentProposal = {
        id: proposalId(),
        title: '이번 주기에서 제외',
        details: [
          { label: '항목', value: view.name },
          { label: '예정일', value: view.scheduledDate },
          { label: '예정 금액', value: view.amount == null ? '미입력' : krw(view.amount) },
          { label: '참고', value: '원본 항목과 다른 달 일정은 유지됩니다' },
        ],
        action: { kind: 'skip_recurring', occurrenceId: occurrence!.id, previousStatus: occurrence!.status },
      };
      return { output: { status: 'awaiting_user_approval', proposalId: proposal.id }, proposal };
    }

    default:
      return fail(`알 수 없는 도구입니다: ${name}`);
  }
}
