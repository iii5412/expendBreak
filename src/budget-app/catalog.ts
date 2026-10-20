import type { Category, PaymentMethodType, QuickEntry } from '../types';
import type { QuickEntrySuggestion } from '../utils/quickEntrySuggestions';
import { quickEntries as defaults } from './mock';

export interface BudgetCategory {
  id: string;
  label: string;
  icon: string;
}
export interface BudgetQuickEntry {
  /** Unique chip key; two chips may share a merchant with different amounts. */
  key?: string;
  merchant: string;
  categoryId: string;
  label: string;
  icon: string;
  /** A number saves in one tap without typing; `null`/missing uses the typed amount. */
  defaultAmount?: number | null;
  cardId?: string | null;
  accountId?: string | null;
  paymentMethodType?: PaymentMethodType;
}

export interface AccountCatalogSources {
  /** The account's saved one-tap entries. */
  quickEntries?: QuickEntry[];
  /** Habits found in recent transactions, used while nothing has been saved. */
  suggestions?: QuickEntrySuggestion[];
  /** Offer the demo chips; only for an account that has no transactions at all. */
  useDefaults?: boolean;
}

const MAX_SUGGESTED_CHIPS = 5;
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

export function accountCatalog(categories: Category[], sources: AccountCatalogSources = {}) {
  const active = categories.filter((c) => c.active && c.type === 'expense');
  const activeById = new Map(active.map((c) => [c.id, c]));
  const aliases = {
    delivery: ['배달'],
    taxi: ['택시', '교통'],
    transport: ['교통'],
    groceries: ['장보기'],
    cafe: ['카페', '외식'],
  };
  const chip = (
    key: string,
    merchant: string,
    categoryId: string,
    amount: number | null,
    extra: Partial<BudgetQuickEntry> = {},
  ): BudgetQuickEntry => ({
    key,
    merchant,
    categoryId,
    label: `${merchant}${amount ? ` ${won(amount)}` : ''} · ${activeById.get(categoryId)?.name || ''}`,
    icon: '🧾',
    defaultAmount: amount,
    ...extra,
  });

  const saved: BudgetQuickEntry[] = (sources.quickEntries || []).flatMap((entry) =>
    entry.type === 'expense' && activeById.has(entry.categoryId)
      ? [
          chip(entry.id, entry.merchant || entry.label, entry.categoryId, entry.amount, {
            cardId: entry.cardId ?? null,
            accountId: entry.accountId ?? null,
            paymentMethodType: entry.paymentMethodType,
          }),
        ]
      : [],
  );
  const suggested: BudgetQuickEntry[] = saved.length
    ? []
    : (sources.suggestions || [])
        .filter((s) => s.type === 'expense' && activeById.has(s.categoryId))
        .slice(0, MAX_SUGGESTED_CHIPS)
        .map((s) => chip(`suggest:${s.merchant}:${s.categoryId}`, s.merchant, s.categoryId, s.fixedAmount));
  const fallback: BudgetQuickEntry[] =
    saved.length || suggested.length || !sources.useDefaults
      ? []
      : defaults.flatMap((q) => {
          const category = active.find((c) => aliases[q.categoryId]?.some((name: string) => c.name.includes(name)));
          return category ? [{ ...q, key: `default:${q.merchant}`, categoryId: category.id, label: `${q.merchant} · ${category.name}` }] : [];
        });
  const quickEntries = [...saved, ...suggested, ...fallback];
  return {
    categories: active.map((c) => ({
      id: c.id,
      label: c.name,
      icon: quickEntries.find((q) => q.categoryId === c.id)?.icon || '🧾',
    })),
    quickEntries,
  };
}
