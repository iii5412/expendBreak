import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Trash2,
  Edit2,
  Sparkles,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Calendar,
  X,
  Check,
} from 'lucide-react';
import { Transaction, Category } from '../types';
import { formatKRW } from '../utils/calculations';

interface HistoryViewProps {
  transactions: Transaction[];
  categories: Category[];
  onDeleteTransaction: (id: string) => void;
  onUpdateTransaction: (id: string, updates: Partial<Transaction>) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  transactions,
  categories,
  onDeleteTransaction,
  onUpdateTransaction,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [aiOnlyFilter, setAiOnlyFilter] = useState(false);

  // Edit State
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  const categoryMap = useMemo(() => {
    return new Map(categories.map(c => [c.id, c]));
  }, [categories]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (selectedCategory !== 'all' && t.categoryId !== selectedCategory) return false;
      if (aiOnlyFilter && t.source !== 'ai') return false;

      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const catName = (categoryMap.get(t.categoryId)?.name || '').toLowerCase();
        const merchant = (t.merchant || '').toLowerCase();
        const memo = (t.memo || '').toLowerCase();
        if (!merchant.includes(query) && !memo.includes(query) && !catName.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [transactions, typeFilter, selectedCategory, aiOnlyFilter, searchTerm, categoryMap]);

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTx) return;
    onUpdateTransaction(editingTx.id, {
      amount: Math.round(Number(editingTx.amount)),
      merchant: editingTx.merchant,
      memo: editingTx.memo,
      categoryId: editingTx.categoryId,
      localDate: editingTx.localDate,
      type: editingTx.type,
    });
    setEditingTx(null);
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Search & Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-3">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="사용처, 메모, 카테고리 검색..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-8 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Type filter */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                typeFilter === 'all' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              전체
            </button>
            <button
              onClick={() => setTypeFilter('income')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                typeFilter === 'income' ? 'bg-emerald-500/20 text-emerald-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              수입
            </button>
            <button
              onClick={() => setTypeFilter('expense')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                typeFilter === 'expense' ? 'bg-rose-500/20 text-rose-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              지출
            </button>
          </div>

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
        </div>
      </div>

      {/* Transaction List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <span>총 {filteredTransactions.length}건의 거래</span>
          <span>최신순 정렬</span>
        </div>

        {filteredTransactions.length === 0 ? (
          <div className="text-center py-12 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-500">
            조건에 해당하는 거래 내역이 없습니다.
          </div>
        ) : (
          filteredTransactions.map(t => {
            const cat = categoryMap.get(t.categoryId);
            const isLowConfidence = t.source === 'ai' && t.aiConfidence && t.aiConfidence < 0.8;

            return (
              <div
                key={t.id}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-3.5 transition-colors flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3">
                  {/* Category color indicator */}
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 font-bold"
                    style={{ backgroundColor: cat?.color || '#64748B' }}
                  >
                    {t.type === 'income' ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100">{t.merchant || '사용처 미입력'}</span>
                      <span className="text-[10px] bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded">
                        {cat?.name || '기타'}
                      </span>
                      {t.source === 'ai' && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>AI</span>
                        </span>
                      )}
                      {isLowConfidence && (
                        <span
                          className="text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30 px-1.5 py-0.5 rounded flex items-center gap-0.5"
                          title="신뢰도가 낮습니다. 카테고리를 확인하세요."
                        >
                          <AlertCircle className="w-2.5 h-2.5 text-rose-400" />
                          <span>확인필요</span>
                        </span>
                      )}
                    </div>
                    <div className="text-slate-400 mt-1 flex items-center gap-2 text-[11px]">
                      <span>{t.localDate}</span>
                      {t.memo && <span>• {t.memo}</span>}
                    </div>
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
                      className="text-slate-500 hover:text-slate-300 p-1"
                      title="수정"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onDeleteTransaction(t.id)}
                      className="text-slate-500 hover:text-rose-400 p-1"
                      title="삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Edit Dialog Modal */}
      {editingTx && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">거래 내역 수정</h3>
              <button onClick={() => setEditingTx(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 mb-1 block">유형</label>
                <select
                  value={editingTx.type}
                  onChange={e => setEditingTx({ ...editingTx, type: e.target.value as 'income' | 'expense' })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100"
                >
                  <option value="expense">지출</option>
                  <option value="income">수입</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 mb-1 block">금액 (KRW)</label>
                <input
                  type="number"
                  value={editingTx.amount}
                  onChange={e => setEditingTx({ ...editingTx, amount: Number(e.target.value) })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 font-bold"
                  required
                />
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
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
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
                  className="bg-rose-500 hover:bg-rose-600 text-white font-semibold px-4 py-2 rounded-lg"
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
