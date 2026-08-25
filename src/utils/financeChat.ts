import {
  BankAccount,
  Budget,
  Category,
  PaymentCard,
  RecurringOccurrence,
  RecurringTemplate,
  Transaction,
} from '../types';
import { createAssistantFinancialSnapshot } from './liveVoice';

const MAX_CHAT_TRANSACTIONS = 200;
const MAX_MONTHS = 12;

const cleanText = (value: unknown, maxLength: number) => String(value || '')
  .replace(/[\u0000-\u001F\u007F]/g, ' ')
  .trim()
  .slice(0, maxLength);

export function createFinanceChatContext(args: {
  transactions: Transaction[];
  categories: Category[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  budget: Budget;
  recurringOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  monthStartDay?: number;
  now?: Date;
}) {
  const categoryNames = new Map(args.categories.map(category => [category.id, category.name]));
  const normalTransactions = args.transactions
    .filter(transaction => !transaction.role || transaction.role === 'normal')
    .filter(transaction => /^\d{4}-\d{2}-\d{2}$/.test(transaction.localDate));

  const monthKeys = [...new Set(normalTransactions.map(transaction => transaction.localDate.slice(0, 7)))]
    .sort((left, right) => right.localeCompare(left))
    .slice(0, MAX_MONTHS);
  const allowedMonths = new Set(monthKeys);
  const monthly = new Map<string, {
    income: number;
    expense: number;
    categories: Map<string, number>;
  }>();

  normalTransactions.forEach(transaction => {
    const month = transaction.localDate.slice(0, 7);
    if (!allowedMonths.has(month)) return;
    const current = monthly.get(month) || { income: 0, expense: 0, categories: new Map<string, number>() };
    const amount = Math.max(0, Math.round(Number(transaction.amount) || 0));
    if (transaction.type === 'income') {
      current.income += amount;
    } else {
      current.expense += amount;
      const category = categoryNames.get(transaction.categoryId) || '미분류';
      current.categories.set(category, (current.categories.get(category) || 0) + amount);
    }
    monthly.set(month, current);
  });

  return {
    오늘: (args.now || new Date()).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }),
    현재재무요약: createAssistantFinancialSnapshot(args),
    최근12개월달력월요약: monthKeys.map(month => {
      const item = monthly.get(month) || { income: 0, expense: 0, categories: new Map<string, number>() };
      return {
        월: month,
        수입: item.income,
        지출: item.expense,
        순액: item.income - item.expense,
        지출상위카테고리: [...item.categories.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 8)
          .map(([category, amount]) => ({ 카테고리: category, 금액: amount })),
      };
    }),
    최근거래: normalTransactions
      .sort((left, right) => `${right.localDate}:${right.createdAt}`.localeCompare(`${left.localDate}:${left.createdAt}`))
      .slice(0, MAX_CHAT_TRANSACTIONS)
      .map(transaction => ({
        날짜: transaction.localDate,
        구분: transaction.type === 'income' ? '수입' : '지출',
        금액: Math.max(0, Math.round(Number(transaction.amount) || 0)),
        카테고리: categoryNames.get(transaction.categoryId) || '미분류',
        사용처: cleanText(transaction.merchant, 80),
        메모: cleanText(transaction.memo, 100),
        결제수단: transaction.paymentMethodType || '미지정',
        태그: (transaction.tags || []).map(tag => cleanText(tag, 30)).filter(Boolean).slice(0, 5),
      })),
  };
}
