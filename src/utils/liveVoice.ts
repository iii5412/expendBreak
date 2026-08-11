import {
  BankAccount,
  Budget,
  Category,
  MerchantRule,
  PaymentCard,
  PaymentMethodType,
  RecurringOccurrence,
  RecurringTemplate,
  Transaction,
  TransactionType,
  VoiceAnalysisResult,
} from '../types';
import { calculateMonthSummary, getLocalDateString, getYearMonthString } from './calculations';

export interface LiveTransactionToolArguments {
  type?: string;
  amount?: number | string;
  date?: string;
  merchant?: string;
  memo?: string;
  category_name?: string;
  payment_method?: string;
  account_name?: string;
  card_name?: string;
  tags?: string[];
  spoken_summary?: string;
  confidence?: number;
  reason?: string;
}

export interface LiveVoiceContext {
  categories: Category[];
  merchantRules: MerchantRule[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  defaultDate?: string;
  modelUsed?: string;
}

export interface LiveTransactionSearchArguments {
  from?: string;
  to?: string;
  type?: string;
  merchant?: string;
  category_name?: string;
  limit?: number;
}

const cleanText = (value: unknown, maxLength: number) => String(value || '').trim().slice(0, maxLength);
const normalized = (value: unknown) => cleanText(value, 200).toLocaleLowerCase('ko-KR').replace(/\s+/g, '');

function resolveTransactionType(value: unknown): TransactionType {
  return value === 'income' || value === '수입' ? 'income' : 'expense';
}

function resolvePaymentMethod(value: unknown): PaymentMethodType {
  const key = normalized(value);
  if (key === 'card' || key.includes('카드')) return 'card';
  if (key === 'account' || key.includes('계좌') || key.includes('이체')) return 'account';
  if (key === 'cash' || key.includes('현금')) return 'cash';
  return 'other';
}

export function resolveLiveCategoryId(
  type: TransactionType,
  categoryName: unknown,
  merchant: unknown,
  categories: Category[],
  merchantRules: MerchantRule[],
) {
  const candidates = categories.filter(category => category.type === type && category.active !== false);
  const requested = normalized(categoryName);
  const exact = requested
    ? candidates.find(category => normalized(category.name) === requested || normalized(category.id) === requested)
    : undefined;
  if (exact) return exact.id;

  const partial = requested
    ? candidates.find(category => normalized(category.name).includes(requested) || requested.includes(normalized(category.name)))
    : undefined;
  if (partial) return partial.id;

  const merchantKey = normalized(merchant);
  const matchedRule = merchantKey
    ? merchantRules.find(rule => merchantKey.includes(normalized(rule.pattern)))
    : undefined;
  const ruledCategory = matchedRule
    ? candidates.find(category => category.id === matchedRule.categoryId)
    : undefined;
  if (ruledCategory) return ruledCategory.id;

  return candidates.find(category => category.id === (type === 'expense' ? 'etc_expense' : 'etc_income'))?.id
    || candidates[0]?.id
    || '';
}

function findNamedId<T extends { id: string }>(items: T[], value: unknown, fields: Array<keyof T>) {
  const key = normalized(value);
  if (!key) return null;
  return items.find(item => fields.some(field => {
    const candidate = normalized(item[field]);
    return candidate === key || candidate.includes(key) || key.includes(candidate);
  }))?.id || null;
}

export function createLiveVoiceResult(
  raw: LiveTransactionToolArguments,
  context: LiveVoiceContext,
): VoiceAnalysisResult {
  const type = resolveTransactionType(raw.type);
  const parsedAmount = Number(raw.amount);
  const amount = Number.isFinite(parsedAmount)
    ? Math.max(0, Math.min(1_000_000_000_000, Math.round(parsedAmount)))
    : 0;
  const defaultDate = context.defaultDate || getLocalDateString();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(cleanText(raw.date, 10))
    ? cleanText(raw.date, 10)
    : defaultDate;
  const merchant = cleanText(raw.merchant, 120) || (type === 'income' ? '수입처 미확인' : '사용처 미확인');
  const paymentMethodType = resolvePaymentMethod(raw.payment_method);
  const transcript = cleanText(raw.spoken_summary, 500)
    || [date, merchant, amount ? `${amount}원` : '', type === 'income' ? '수입' : '지출'].filter(Boolean).join(' ');
  const confidenceValue = Number(raw.confidence);

  return {
    transcript,
    type,
    amount,
    date,
    merchant,
    memo: cleanText(raw.memo, 500) || transcript,
    suggestedCategoryId: resolveLiveCategoryId(
      type,
      raw.category_name,
      merchant,
      context.categories,
      context.merchantRules,
    ),
    paymentMethodType,
    paymentMethodHint: cleanText(raw.card_name || raw.account_name || raw.payment_method, 100),
    suggestedAccountId: paymentMethodType === 'account'
      ? findNamedId(context.bankAccounts, raw.account_name, ['bankName', 'accountName'])
      : null,
    suggestedCardId: paymentMethodType === 'card'
      ? findNamedId(context.paymentCards, raw.card_name, ['cardName', 'cardCompany'])
      : null,
    tags: Array.isArray(raw.tags)
      ? raw.tags.map(tag => cleanText(tag, 40).replace(/^#/, '')).filter(Boolean).slice(0, 10)
      : [],
    confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0.8,
    reason: cleanText(raw.reason, 300) || 'GPT 라이브 대화에서 만든 거래 초안',
    multipleTransactionsDetected: false,
    needsConfirmation: true,
    modelUsed: context.modelUsed || 'gpt-4o-mini-realtime-preview',
    fallbackUsed: false,
  };
}

export function createAssistantFinancialSnapshot(args: {
  transactions: Transaction[];
  categories: Category[];
  bankAccounts: BankAccount[];
  budget: Budget;
  recurringOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  now?: Date;
}) {
  const now = args.now || new Date();
  const yearMonth = getYearMonthString(now);
  const summary = calculateMonthSummary(
    yearMonth,
    args.transactions,
    args.recurringOccurrences,
    args.budget,
    args.recurringTemplates,
    now,
  );
  const categoryMap = new Map(args.categories.map(category => [category.id, category.name]));
  const expenseByCategory = new Map<string, number>();
  args.transactions
    .filter(transaction => transaction.type === 'expense' && transaction.localDate.startsWith(yearMonth))
    .forEach(transaction => {
      expenseByCategory.set(
        transaction.categoryId,
        (expenseByCategory.get(transaction.categoryId) || 0) + Math.round(transaction.amount),
      );
    });

  return {
    기준월: yearMonth,
    확정수입: summary.confirmedIncome,
    확정지출: summary.confirmedExpenses,
    순현금흐름: summary.netCashFlow,
    월예산: summary.monthlyBudgetLimit,
    남은예산: summary.simpleRemainingLimit,
    예정고정지출: summary.remainingScheduledExpenses,
    오늘안전사용가능액: summary.dailySafeAllowance,
    월말예상지출: summary.forecastMonthEndSpend,
    수동계좌잔액합계: args.bankAccounts.reduce((sum, account) => sum + Math.round(account.balance || 0), 0),
    계좌잔액: args.bankAccounts.map(account => ({
      은행: account.bankName,
      별칭: account.accountName,
      잔액: Math.round(account.balance || 0),
      기준일: account.balanceAsOf || null,
    })),
    지출상위카테고리: [...expenseByCategory.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([categoryId, amount]) => ({ 카테고리: categoryMap.get(categoryId) || '미분류', 금액: amount })),
  };
}

export function searchTransactionsForAssistant(
  transactions: Transaction[],
  categories: Category[],
  query: LiveTransactionSearchArguments,
) {
  const categoryMap = new Map(categories.map(category => [category.id, category.name]));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from! : '0000-01-01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to! : '9999-12-31';
  const type = query.type === 'income' || query.type === 'expense' ? query.type : null;
  const merchantKey = normalized(query.merchant);
  const categoryKey = normalized(query.category_name);
  const limit = Math.max(1, Math.min(30, Math.round(Number(query.limit) || 15)));

  const matched = transactions
    .filter(transaction => transaction.localDate >= from && transaction.localDate <= to)
    .filter(transaction => !type || transaction.type === type)
    .filter(transaction => !merchantKey || normalized(transaction.merchant).includes(merchantKey))
    .filter(transaction => !categoryKey || normalized(categoryMap.get(transaction.categoryId)).includes(categoryKey))
    .sort((left, right) => right.localDate.localeCompare(left.localDate))
    .slice(0, limit);

  return {
    조회건수: matched.length,
    합계: matched.reduce((sum, transaction) => sum + Math.round(transaction.amount), 0),
    거래: matched.map(transaction => ({
      날짜: transaction.localDate,
      구분: transaction.type === 'income' ? '수입' : '지출',
      금액: Math.round(transaction.amount),
      카테고리: categoryMap.get(transaction.categoryId) || '미분류',
      사용처: transaction.merchant,
      메모: cleanText(transaction.memo, 120),
    })),
  };
}
