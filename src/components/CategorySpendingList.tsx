import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { BankAccount, PaymentCard, Transaction } from '../types';
import { CategoryBreakdownEntry, formatKRW } from '../utils/calculations';

export interface CategorySpendingItem {
  categoryId: string;
  name: string;
  value: number;
  color: string;
}

interface CategorySpendingListProps {
  items: CategorySpendingItem[];
  entries: CategoryBreakdownEntry[];
  paymentCards?: PaymentCard[];
  bankAccounts?: BankAccount[];
}

const ALL = '__all__';

/** Payment label and the key the filter chips group by. */
export function paymentOf(
  transaction: Transaction,
  cards: Map<string, PaymentCard>,
  accounts: Map<string, BankAccount>,
): { key: string; label: string } {
  if (transaction.cardId) {
    const card = cards.get(transaction.cardId);
    // Group by company: "신한카드" is how people ask about their cards.
    if (card) return { key: `card:${card.cardCompany}`, label: card.cardCompany || card.cardName };
    return { key: 'card:?', label: '카드' };
  }
  if (transaction.paymentMethodType === 'account' || transaction.accountId) {
    const account = transaction.accountId ? accounts.get(transaction.accountId) : null;
    return { key: `account:${transaction.accountId ?? '?'}`, label: account ? `${account.bankName} ${account.accountName}` : '계좌' };
  }
  if (transaction.paymentMethodType === 'cash') return { key: 'cash', label: '현금' };
  return { key: 'none', label: '결제수단 미지정' };
}

const shortDate = (localDate: string) => `${Number(localDate.slice(5, 7))}/${Number(localDate.slice(8, 10))}`;

/**
 * Category totals of the living budget. Tapping a category opens the
 * expenses behind it, filterable by card company or account; the list uses
 * the same entries as the total, so it always adds up.
 */
export const CategorySpendingList: React.FC<CategorySpendingListProps> = ({
  items,
  entries,
  paymentCards = [],
  bankAccounts = [],
}) => {
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const [paymentKey, setPaymentKey] = useState(ALL);
  const cards = useMemo(() => new Map(paymentCards.map(card => [card.id, card])), [paymentCards]);
  const accounts = useMemo(() => new Map(bankAccounts.map(account => [account.id, account])), [bankAccounts]);

  const toggle = (categoryId: string) => {
    setOpenCategoryId(current => (current === categoryId ? null : categoryId));
    setPaymentKey(ALL);
  };

  const renderDetail = (categoryId: string) => {
    const rows = entries
      .filter(entry => entry.categoryId === categoryId)
      .map(entry => ({ ...entry, payment: paymentOf(entry.transaction, cards, accounts) }))
      .sort((left, right) => `${right.transaction.localDate}${right.transaction.createdAt}`
        .localeCompare(`${left.transaction.localDate}${left.transaction.createdAt}`));
    const payments = [...new Map(rows.map(row => [row.payment.key, row.payment.label])).entries()];
    const shown = paymentKey === ALL ? rows : rows.filter(row => row.payment.key === paymentKey);
    const shownTotal = shown.reduce((sum, row) => sum + row.amount, 0);

    return (
      <div className="mt-1 space-y-2 rounded-lg border border-slate-800 bg-slate-950/70 p-2">
        {payments.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="결제수단으로 거르기">
            {[[ALL, '전체'] as const, ...payments].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPaymentKey(key)}
                aria-pressed={paymentKey === key}
                className={`min-h-8 rounded-full border px-3 text-[11px] font-bold ${paymentKey === key
                  ? 'border-rose-400 bg-rose-500/15 text-rose-200'
                  : 'border-slate-700 text-slate-400'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <ul className="divide-y divide-slate-800/70">
          {shown.map(row => (
            <li key={row.transaction.id} className="flex items-center justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-slate-200">{row.transaction.merchant || '사용처 미입력'}</p>
                <p className="text-[11px] text-slate-500">
                  {shortDate(row.transaction.localDate)} · {row.payment.label}
                  {row.installmentRound !== null && row.transaction.installment
                    ? ` · 할부 ${row.installmentRound}/${row.transaction.installment.totalMonths}회`
                    : ''}
                </p>
              </div>
              <span className="shrink-0 font-bold text-slate-100">{formatKRW(row.amount)}</span>
            </li>
          ))}
        </ul>
        <p className="flex justify-between border-t border-slate-800 pt-1.5 text-[11px] text-slate-400">
          <span>{shown.length}건</span>
          <span className="font-bold text-slate-200">{formatKRW(shownTotal)}</span>
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-1.5 text-xs">
      {items.map(item => {
        const open = openCategoryId === item.categoryId;
        return (
          <div key={item.categoryId}>
            <button
              type="button"
              onClick={() => toggle(item.categoryId)}
              aria-expanded={open}
              className="flex min-h-9 w-full items-center justify-between gap-2 rounded bg-slate-950/40 p-1.5 text-left"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="truncate font-medium text-slate-300">{item.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="font-bold text-slate-100">{formatKRW(item.value)}</span>
                <ChevronDown className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
              </span>
            </button>
            {open && renderDetail(item.categoryId)}
          </div>
        );
      })}
    </div>
  );
};
