import React, { useEffect, useState, useMemo } from 'react';
import {
  Search,
  Trash2,
  Edit2,
  Sparkles,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  X,
  Check,
  ReceiptText,
  Tags,
  Mic,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Transaction, Category, BankAccount, PaymentCard, PaymentMethodType } from '../types';
import { AccountingPeriod, formatKRW, formatPeriodRange, getLocalDateString } from '../utils/calculations';
import { normalizeTags } from '../utils/receipt';
import { ReceiptDetailsModal } from './ReceiptDetailsModal';
import {
  HistoryKind,
  HistoryPeriod,
  isTransactionInPeriod,
  matchesHistoryKind,
  sortTransactionsNewestFirst,
} from '../utils/history';
import { Modal } from './ui/Modal';
import { AmountInput } from './ui/AmountInput';
import { useConfirm, useToast } from './ui/FeedbackProvider';
import { normalizeInstallmentPlan } from '../utils/installments';

const HISTORY_PAGE_SIZES = [10, 20, 50];

/** Marks the searched substring so a hit in a long memo is easy to spot. */
function highlight(text: string, query: string): React.ReactNode {
  const needle = query.trim().toLowerCase();
  if (!needle) return text;
  const index = text.toLowerCase().indexOf(needle);
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-amber-400/30 px-0.5 text-amber-100">
        {text.slice(index, index + needle.length)}
      </mark>
      {text.slice(index + needle.length)}
    </>
  );
}

interface HistoryViewProps {
  transactions: Transaction[];
  categories: Category[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  /** App-wide accounting period; the default filter follows it. */
  period: AccountingPeriod;
  /** Owns the confirmation dialog and the undo window (see App). */
  onDeleteTransaction: (transaction: Transaction) => void;
  onUpdateTransaction: (id: string, updates: Partial<Transaction>) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  transactions,
  categories,
  bankAccounts,
  paymentCards,
  period,
  onDeleteTransaction,
  onUpdateTransaction,
}) => {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [searchTerm, setSearchTerm] = useState('');
  const [historyKind, setHistoryKind] = useState<HistoryKind>('regular_expense');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [aiOnlyFilter, setAiOnlyFilter] = useState(false);
  const [receiptOnlyFilter, setReceiptOnlyFilter] = useState(false);
  const [periodFilter, setPeriodFilter] = useState<HistoryPeriod>('period');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(HISTORY_PAGE_SIZES[0]);

  // Edit State
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [viewingReceiptTx, setViewingReceiptTx] = useState<Transaction | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const categoryMap = useMemo(() => {
    return new Map(categories.map(c => [c.id, c]));
  }, [categories]);

  const filteredTransactions = useMemo(() => {
    const filtered = transactions.filter(t => {
      if (!isTransactionInPeriod(t, periodFilter, new Date(), period)) return false;
      if (!matchesHistoryKind(t, historyKind)) return false;
      if (selectedCategory !== 'all' && t.categoryId !== selectedCategory) return false;
      if (aiOnlyFilter && t.source === 'manual') return false;
      if (receiptOnlyFilter && !t.receipt) return false;

      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const catName = (categoryMap.get(t.categoryId)?.name || '').toLowerCase();
        const merchant = (t.merchant || '').toLowerCase();
        const memo = (t.memo || '').toLowerCase();
        const receiptText = `${t.receipt?.rawText || ''} ${(t.receipt?.lineItems || []).map(item => item.name).join(' ')}`.toLowerCase();
        const tags = (t.tags || []).join(' ').toLowerCase();
        if (!merchant.includes(query) && !memo.includes(query) && !catName.includes(query) && !receiptText.includes(query) && !tags.includes(query)) {
          return false;
        }
      }
      return true;
    });
    return sortTransactionsNewestFirst(filtered);
  }, [transactions, periodFilter, period, historyKind, selectedCategory, aiOnlyFilter, receiptOnlyFilter, searchTerm, categoryMap]);

  const periodRange = formatPeriodRange(period);
  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedTransactions = filteredTransactions.slice(pageStart, pageStart + pageSize);
  const todayText = getLocalDateString();

  const filteredTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const transaction of filteredTransactions) {
      if (transaction.type === 'income') income += Math.round(transaction.amount);
      else expense += Math.round(transaction.amount);
    }
    return { income, expense, net: income - expense };
  }, [filteredTransactions]);

  const isPageFullySelected = paginatedTransactions.length > 0
    && paginatedTransactions.every(transaction => selectedIds.has(transaction.id));

  const togglePageSelection = () => {
    setSelectedIds(current => {
      const next = new Set(current);
      paginatedTransactions.forEach(transaction => {
        if (isPageFullySelected) next.delete(transaction.id);
        else next.add(transaction.id);
      });
      return next;
    });
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyBulkCategory = async (categoryId: string) => {
    const target = categories.find(category => category.id === categoryId);
    if (!target) return;

    // A category belongs to one type, so only matching transactions can move.
    const selected = filteredTransactions.filter(transaction => selectedIds.has(transaction.id));
    const applicable = selected.filter(transaction => transaction.type === target.type);
    const skipped = selected.length - applicable.length;

    if (applicable.length === 0) {
      showToast({
        message: '변경할 수 있는 거래가 없습니다.',
        description: `'${target.name}'은 ${target.type === 'income' ? '수입' : '지출'} 카테고리라 선택한 거래에 적용할 수 없습니다.`,
        tone: 'error',
      });
      return;
    }

    const accepted = await confirm({
      title: '카테고리를 일괄 변경할까요?',
      description: skipped > 0
        ? `유형이 다른 ${skipped}건은 건너뜁니다.`
        : undefined,
      details: [
        { label: '대상', value: `${applicable.length}건` },
        { label: '새 카테고리', value: `${target.name} (${target.type === 'income' ? '수입' : '지출'})` },
      ],
      confirmLabel: '변경',
    });
    if (!accepted) return;

    const previous = applicable.map(transaction => ({ id: transaction.id, categoryId: transaction.categoryId }));
    applicable.forEach(transaction => onUpdateTransaction(transaction.id, { categoryId }));
    setSelectedIds(new Set());

    showToast({
      message: `${applicable.length}건의 카테고리를 변경했습니다.`,
      tone: 'success',
      action: {
        label: '실행 취소',
        onAction: () => {
          previous.forEach(item => onUpdateTransaction(item.id, { categoryId: item.categoryId }));
          showToast({ message: '카테고리 변경을 취소했습니다.', tone: 'info' });
        },
      },
    });
  };

  useEffect(() => {
    setCurrentPage(1);
    // Selections refer to rows that may no longer be listed after a filter change.
    setSelectedIds(new Set());
  }, [periodFilter, historyKind, selectedCategory, aiOnlyFilter, receiptOnlyFilter, searchTerm, pageSize]);

  useEffect(() => {
    setCurrentPage(page => Math.min(page, totalPages));
  }, [totalPages]);

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTx) return;
    const amount = Math.round(Number(editingTx.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      setEditError('1원 이상의 금액을 입력해 주세요.');
      document.getElementById('edit-tx-amount')?.focus();
      return;
    }
    const selectedCategory = categories.find(category => category.id === editingTx.categoryId);
    if (!selectedCategory || selectedCategory.type !== editingTx.type) {
      setEditError(`${editingTx.type === 'expense' ? '지출' : '수입'} 유형에 맞는 카테고리를 선택해 주세요.`);
      return;
    }
    const paymentMethodType = editingTx.paymentMethodType || 'other';
    if (paymentMethodType === 'card' && paymentCards.length > 0 && !editingTx.cardId) {
      setEditError('사용한 카드를 선택해 주세요.');
      return;
    }
    setEditError(null);
    onUpdateTransaction(editingTx.id, {
      amount,
      merchant: editingTx.merchant,
      memo: editingTx.memo,
      categoryId: editingTx.categoryId,
      localDate: editingTx.localDate,
      occurredAt: `${editingTx.localDate}T12:00:00.000Z`,
      type: editingTx.type,
      tags: normalizeTags(editingTx.tags || []),
      paymentMethodType,
      accountId: paymentMethodType === 'account' ? editingTx.accountId || null : null,
      cardId: paymentMethodType === 'card' ? editingTx.cardId || null : null,
      installment: editingTx.type === 'expense' && paymentMethodType === 'card'
        ? editingTx.installment ?? null
        : null,
    });
    setEditingTx(null);
  };

  return (
    <div className="space-y-4 pb-24">
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1.5 text-xs sm:grid-cols-4">
        {([
          ['regular_expense', '일반지출'],
          ['fixed_expense', '고정지출'],
          ['income', '수입'],
          ['all', '전체 내역'],
        ] as Array<[HistoryKind, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setHistoryKind(value);
              setSelectedCategory('all');
            }}
            aria-pressed={historyKind === value}
            className={`min-h-11 rounded-lg px-3 py-2 font-bold transition-colors ${
              historyKind === value
                ? value === 'fixed_expense'
                  ? 'border border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : value === 'income'
                    ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : 'border border-rose-500/40 bg-rose-500/15 text-rose-300'
                : 'border border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-3">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="사용처, 메모, 태그, 영수증 품목 검색..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-8 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              aria-label="검색어 지우기"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-1 text-slate-400">조회 기간</span>
          {([
            ['period', periodRange ? `이번 기간 (${periodRange})` : '이번 달'],
            ['today', '오늘'],
            ['7days', '최근 7일'],
            ['30days', '최근 30일'],
            ['all', '전체 기간'],
          ] as Array<[HistoryPeriod, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setPeriodFilter(value)}
              className={`rounded-lg border px-2.5 py-1.5 transition-colors ${
                periodFilter === value
                  ? 'border-rose-500/40 bg-rose-500/15 font-bold text-rose-300'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Category Dropdown */}
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="bg-slate-950 border border-slate-800 text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-rose-500"
          >
            <option value="all">전체 카테고리</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type === 'income' ? '수입' : '지출'})
              </option>
            ))}
          </select>

          {/* AI Filter Toggle */}
          <button
            onClick={() => setAiOnlyFilter(!aiOnlyFilter)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
              aiOnlyFilter
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>AI 자동기록만</span>
          </button>

          <button
            onClick={() => setReceiptOnlyFilter(!receiptOnlyFilter)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
              receiptOnlyFilter
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 font-semibold'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <ReceiptText className="w-3.5 h-3.5" />
            <span>영수증만</span>
          </button>
        </div>
      </div>

      {/* Totals for the current filter, so the list reconciles with the home card. */}
      <dl className="grid grid-cols-3 gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs">
        <div>
          <dt className="text-slate-400">수입</dt>
          <dd className="mt-0.5 font-bold text-emerald-400">{formatKRW(filteredTotals.income)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">지출</dt>
          <dd className="mt-0.5 font-bold text-rose-300">{formatKRW(filteredTotals.expense)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">순액</dt>
          <dd className={`mt-0.5 font-bold ${filteredTotals.net >= 0 ? 'text-emerald-400' : 'text-rose-300'}`}>
            {filteredTotals.net >= 0 ? '+' : '-'}{formatKRW(Math.abs(filteredTotals.net))}
          </dd>
        </div>
      </dl>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/40 bg-slate-900/95 p-3 text-xs backdrop-blur-md">
          <span className="font-bold text-rose-300">{selectedIds.size}건 선택됨</span>
          <select
            value=""
            onChange={event => {
              if (event.target.value) void applyBulkCategory(event.target.value);
              event.target.value = '';
            }}
            aria-label="선택한 거래의 카테고리 일괄 변경"
            className="min-h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-slate-200 focus:border-rose-500 focus:outline-none"
          >
            <option value="">카테고리 일괄 변경…</option>
            {categories.filter(c => c.active).map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.type === 'income' ? '수입' : '지출'})</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto min-h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 font-semibold text-slate-300 transition-colors hover:bg-slate-800"
          >
            선택 해제
          </button>
        </div>
      )}

      {/* Transaction List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <span>
            총 {filteredTransactions.length}건
            {filteredTransactions.length > 0 && ` · ${pageStart + 1}-${Math.min(pageStart + pageSize, filteredTransactions.length)}건 표시`}
          </span>
          {paginatedTransactions.length > 0 && (
            <button
              type="button"
              onClick={togglePageSelection}
              className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-slate-300 transition-colors hover:bg-slate-800"
            >
              {isPageFullySelected ? '이 페이지 선택 해제' : '이 페이지 전체 선택'}
            </button>
          )}
          <label className="flex items-center gap-1.5">
            <span>페이지당</span>
            <select
              value={pageSize}
              onChange={event => setPageSize(Number(event.target.value))}
              className="rounded-md border border-slate-800 bg-slate-950 px-1.5 py-1 text-slate-300 focus:outline-none focus:border-rose-500"
            >
              {HISTORY_PAGE_SIZES.map(size => <option key={size} value={size}>{size}건</option>)}
            </select>
          </label>
        </div>

        {filteredTransactions.length === 0 ? (
          <div className="text-center py-12 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-400">
            조건에 해당하는 거래 내역이 없습니다.
          </div>
        ) : (
          paginatedTransactions.map((t, index) => {
            const cat = categoryMap.get(t.categoryId);
            const isLowConfidence = t.source === 'ai' && t.aiConfidence && t.aiConfidence < 0.8;
            const startsNewDate = index === 0 || paginatedTransactions[index - 1].localDate !== t.localDate;

            return (
              <React.Fragment key={t.id}>
                {startsNewDate && (
                  <div className="flex items-center gap-2 px-1 pt-2 text-xs font-bold text-slate-400">
                    <span>{t.localDate === todayText ? '오늘' : t.localDate}</span>
                    {t.localDate === todayText && <span className="font-normal text-slate-400">{t.localDate}</span>}
                    <span className="h-px flex-1 bg-slate-800" />
                  </div>
                )}
                <div className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 text-xs transition-colors ${
                  selectedIds.has(t.id)
                    ? 'border-rose-500/50 bg-rose-500/5'
                    : 'border-slate-800 bg-slate-900 hover:border-slate-700'
                }`}>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(t.id)}
                    onChange={() => toggleSelection(t.id)}
                    aria-label={`${t.merchant || '사용처 미입력'} 거래 선택`}
                    className="h-4 w-4 shrink-0 rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500"
                  />
                  {/* Category color indicator */}
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 font-bold"
                    style={{ backgroundColor: cat?.color || '#64748B' }}
                  >
                    {t.type === 'income' ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100">
                        {highlight(t.merchant || '사용처 미입력', searchTerm)}
                      </span>
                      <span className="text-xs bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded">
                        {cat?.name || '기타'}
                      </span>
                      {t.source === 'ai' && (
                        <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>AI</span>
                        </span>
                      )}
                      {t.source === 'voice' && (
                        <span className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <Mic className="w-2.5 h-2.5" />
                          <span>음성</span>
                        </span>
                      )}
                      {t.receipt && (
                        <button onClick={() => setViewingReceiptTx(t)} className="text-xs bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <ReceiptText className="w-2.5 h-2.5" /><span>영수증</span>
                        </button>
                      )}
                      {t.installment && (
                        <span className="text-xs bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded">
                          할부 {t.installment.currentRound}/{t.installment.totalMonths}회차
                        </span>
                      )}
                      {isLowConfidence && (
                        <span
                          className="text-xs bg-rose-500/20 text-rose-300 border border-rose-500/30 px-1.5 py-0.5 rounded flex items-center gap-0.5"
                          title="신뢰도가 낮습니다. 카테고리를 확인하세요."
                        >
                          <AlertCircle className="w-2.5 h-2.5 text-rose-400" />
                          <span>확인필요</span>
                        </span>
                      )}
                    </div>
                    <div className="text-slate-400 mt-1 flex items-center gap-2 text-xs">
                      <span>{t.localDate}</span>
                      {t.memo && <span>• {highlight(t.memo, searchTerm)}</span>}
                    </div>
                    {(t.tags || []).length > 0 && <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-400"><Tags className="h-3 w-3" />{t.tags!.map(tag => <span key={tag}>#{tag}</span>)}</div>}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div
                    className={`font-extrabold text-sm ${
                      t.type === 'income' ? 'text-emerald-400' : 'text-slate-100'
                    }`}
                  >
                    {t.type === 'income' ? '+' : '-'}{formatKRW(t.amount)}
                  </div>

                  <div className="flex items-center justify-end gap-1.5 mt-1">
                    <button
                      onClick={() => setEditingTx(t)}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-300"
                      title="수정"
                      aria-label={`${t.merchant || '사용처 미입력'} 거래 수정`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onDeleteTransaction(t)}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                      title="삭제"
                      aria-label={`${t.merchant || '사용처 미입력'} 거래 삭제`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                </div>
              </React.Fragment>
            );
          })
        )}

        {filteredTransactions.length > 0 && totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-3 text-xs">
            <button
              type="button"
              onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
              disabled={currentPage === 1}
              className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-300 transition-colors hover:border-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> 이전
            </button>
            <span className="min-w-16 text-center font-semibold text-slate-300">{currentPage} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
              disabled={currentPage === totalPages}
              className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-300 transition-colors hover:border-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              다음 <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Edit Dialog Modal */}
      <Modal
        isOpen={Boolean(editingTx)}
        onClose={() => setEditingTx(null)}
        labelledById="edit-transaction-title"
        panelClassName="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4"
      >
        {editingTx && (
          <>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 id="edit-transaction-title" className="text-sm font-bold text-white">거래 내역 수정</h3>
              <button
                onClick={() => setEditingTx(null)}
                aria-label="수정 창 닫기"
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs" noValidate>
              <div>
                <label className="text-slate-400 mb-1 block">유형</label>
                <select
                  value={editingTx.type}
                  onChange={e => {
                    const nextType = e.target.value as 'income' | 'expense';
                    const currentCategory = categories.find(category => category.id === editingTx.categoryId);
                    const nextCategoryId = currentCategory?.type === nextType
                      ? currentCategory.id
                      : categories.find(category => category.id === (nextType === 'expense' ? 'etc_expense' : 'etc_income'))?.id
                        || categories.find(category => category.type === nextType && category.active)?.id
                        || '';
                    setEditingTx({ ...editingTx, type: nextType, categoryId: nextCategoryId });
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100"
                >
                  <option value="expense">지출</option>
                  <option value="income">수입</option>
                </select>
              </div>

              <div>
                <label htmlFor="edit-tx-amount" className="text-slate-400 mb-1 block">금액 (KRW)</label>
                <AmountInput
                  id="edit-tx-amount"
                  value={Number(editingTx.amount) || 0}
                  onChange={next => {
                    setEditError(null);
                    setEditingTx({ ...editingTx, amount: next });
                  }}
                  invalid={Boolean(editError)}
                  describedById={editError ? 'edit-tx-amount-error' : undefined}
                />
                {editError && (
                  <p id="edit-tx-amount-error" role="alert" className="mt-1.5 text-xs font-semibold text-rose-300">
                    {editError}
                  </p>
                )}
              </div>

              <div>
                <label className="text-slate-400 mb-1 block">날짜</label>
                <input
                  type="date"
                  value={editingTx.localDate}
                  onChange={e => setEditingTx({ ...editingTx, localDate: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="text-slate-400 mb-1 block">사용처 / 거래처</label>
                <input
                  type="text"
                  value={editingTx.merchant}
                  onChange={e => setEditingTx({ ...editingTx, merchant: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="text-slate-400 mb-1 block">카테고리</label>
                <select
                  value={editingTx.categoryId}
                  onChange={e => setEditingTx({ ...editingTx, categoryId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100"
                >
                  {categories.filter(c => c.type === editingTx.type && c.active).map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-400 mb-1 block">결제 / 출금 수단</label>
                <div className="grid grid-cols-3 gap-2">
                  {([['card', '카드'], ['account', '계좌'], ['cash', '현금/기타']] as Array<[PaymentMethodType, string]>).map(([method, label]) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => {
                        setEditError(null);
                        setEditingTx({
                          ...editingTx,
                          paymentMethodType: method,
                          accountId: method === 'account' ? editingTx.accountId : null,
                          cardId: method === 'card' ? (editingTx.cardId || paymentCards[0]?.id || null) : null,
                          installment: method === 'card' ? editingTx.installment : null,
                        });
                      }}
                      className={`rounded-lg border p-2 font-semibold ${
                        (editingTx.paymentMethodType || 'other') === method
                          || (method === 'cash' && (editingTx.paymentMethodType || 'other') === 'other')
                          ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200'
                          : 'border-slate-800 bg-slate-950 text-slate-400'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {(editingTx.paymentMethodType || 'other') === 'card' && (
                  <select
                    value={editingTx.cardId || ''}
                    onChange={event => setEditingTx({ ...editingTx, cardId: event.target.value || null })}
                    disabled={paymentCards.length === 0}
                    className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-slate-100 disabled:text-slate-500"
                  >
                    <option value="">{paymentCards.length > 0 ? '-- 카드 선택 --' : '등록된 카드 없음'}</option>
                    {paymentCards.map(card => <option key={card.id} value={card.id}>{card.cardName} ({card.cardCompany})</option>)}
                  </select>
                )}
                {(editingTx.paymentMethodType || 'other') === 'account' && (
                  <select
                    value={editingTx.accountId || ''}
                    onChange={event => setEditingTx({ ...editingTx, accountId: event.target.value || null })}
                    disabled={bankAccounts.length === 0}
                    className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-slate-100 disabled:text-slate-500"
                  >
                    <option value="">{bankAccounts.length > 0 ? '-- 계좌 선택 --' : '등록된 계좌 없음'}</option>
                    {bankAccounts.map(account => <option key={account.id} value={account.id}>[{account.bankName}] {account.accountName}</option>)}
                  </select>
                )}
                {editingTx.type === 'expense' && (editingTx.paymentMethodType || 'other') === 'card' && (
                  <div className="mt-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-slate-400">
                        <span className="mb-1 block">할부 개월</span>
                        <input
                          type="number"
                          min="1"
                          max="60"
                          value={editingTx.installment?.totalMonths || 1}
                          onChange={event => {
                            const months = Math.min(60, Math.max(1, Number(event.target.value) || 1));
                            setEditingTx({
                              ...editingTx,
                              installment: normalizeInstallmentPlan(
                                months,
                                Math.min(months, editingTx.installment?.currentRound || 1),
                                period.yearMonth,
                              ),
                            });
                          }}
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2 text-white"
                        />
                      </label>
                      <label className="text-slate-400">
                        <span className="mb-1 block">이번 달 회차</span>
                        <input
                          type="number"
                          min="1"
                          max={editingTx.installment?.totalMonths || 1}
                          disabled={!editingTx.installment}
                          value={editingTx.installment?.currentRound || 1}
                          onChange={event => setEditingTx({
                            ...editingTx,
                            installment: normalizeInstallmentPlan(
                              editingTx.installment?.totalMonths || 1,
                              Number(event.target.value) || 1,
                              period.yearMonth,
                            ),
                          })}
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2 text-white disabled:opacity-50"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-slate-400 mb-1 block">메모</label>
                <input
                  type="text"
                  value={editingTx.memo}
                  onChange={e => setEditingTx({ ...editingTx, memo: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100"
                />
              </div>

              <div>
                <label className="text-slate-400 mb-1 block">생활 태그</label>
                <input
                  type="text"
                  value={(editingTx.tags || []).join(', ')}
                  onChange={e => setEditingTx({ ...editingTx, tags: e.target.value.split(',') })}
                  placeholder="예: 가족, 여행, 병원"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingTx(null)}
                  className="bg-slate-800 text-slate-300 px-4 py-2 rounded-lg"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="bg-rose-600 hover:bg-rose-700 text-white font-semibold px-4 py-2 rounded-lg"
                >
                  저장
                </button>
              </div>
            </form>
          </>
        )}
      </Modal>

      {viewingReceiptTx?.receipt && <ReceiptDetailsModal receipt={viewingReceiptTx.receipt} merchant={viewingReceiptTx.merchant} onClose={() => setViewingReceiptTx(null)} />}
    </div>
  );
};
