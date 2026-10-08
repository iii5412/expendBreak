import React, { useMemo, useState } from 'react';
import type { Category, PaymentCard, Transaction } from '../types';
import { authenticatedFetch } from '../utils/auth';
import { formatKRW } from '../utils/calculations';
import {
  reconcileCardStatement,
  validateExtractedStatement,
  type StatementParseResult,
} from '../utils/cardStatementReconcile';

type Draft = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;

interface Props {
  categories: Category[];
  paymentCards: PaymentCard[];
  transactions: Transaction[];
  getCurrentTransactions: () => Transaction[];
  onSave: (draft: Draft) => Transaction;
  onUpdate: (id: string, expectedUpdatedAt: string, updates: Partial<Transaction>) => Transaction | null;
}

export const CardStatementReconcilePanel: React.FC<Props> = ({
  categories, paymentCards, transactions, getCurrentTransactions, onSave, onUpdate,
}) => {
  const [text, setText] = useState('');
  const [cardId, setCardId] = useState(paymentCards[0]?.id || '');
  const [parsed, setParsed] = useState<StatementParseResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [categoryByLine, setCategoryByLine] = useState<Record<number, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const expenseCategories = categories.filter(category => category.type === 'expense' && category.active);
  const defaultCategoryId = expenseCategories.find(category => category.id === 'etc_expense')?.id || expenseCategories[0]?.id || '';
  const selectedCardId = cardId || null;
  const matches = useMemo(
    () => reconcileCardStatement(parsed?.rows || [], transactions, selectedCardId),
    [parsed, transactions, selectedCardId],
  );

  const analyze = async () => {
    setError(null);
    setResult(null);
    if (paymentCards.length > 0 && !cardId) {
      setError('대조할 카드를 선택해 주세요.');
      return;
    }
    setIsAnalyzing(true);
    try {
      const response = await authenticatedFetch('/api/ai/card-statement/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          existing: transactions
            .filter(transaction => transaction.type === 'expense'
              && (!transaction.role || transaction.role === 'normal')
              && (!transaction.paymentMethodType || transaction.paymentMethodType === 'card')
              && (!selectedCardId || !transaction.cardId || transaction.cardId === selectedCardId))
            .sort((left, right) => right.localDate.localeCompare(left.localDate))
            .slice(0, 250)
            .map(transaction => ({
              id: transaction.id,
              localDate: transaction.localDate,
              merchant: transaction.merchant,
              amount: transaction.amount,
            })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || '카드 내역을 읽지 못했습니다.');
      const next: StatementParseResult = {
        rows: Array.isArray(data.rows) ? data.rows : [],
        issues: Array.isArray(data.issues) ? data.issues : [],
      };
      setParsed(next);
      setSelected(new Set());
      setCategoryByLine({});
      if (next.rows.length === 0) setError('AI가 확인할 수 있는 승인 거래를 찾지 못했습니다. 내역을 확인해 주세요.');
    } catch (nextError) {
      setParsed(null);
      setError(nextError instanceof Error ? nextError.message : '카드 내역 인식 중 오류가 발생했습니다.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const editRow = (line: number, updates: Partial<StatementParseResult['rows'][number]>) => {
    setParsed(current => current ? { ...current, rows: current.rows.map(row => row.line === line
      ? { ...row, ...updates, suggestedTransactionId: '', matchReason: '' } : row) } : current);
    setSelected(current => { const next = new Set(current); next.delete(line); return next; });
  };

  const apply = () => {
    if (!parsed || selected.size === 0) return;
    let added = 0;
    let corrected = 0;
    let skipped = 0;
    for (const match of matches) {
      const { row } = match;
      if (!selected.has(row.line)) continue;
      const validated = validateExtractedStatement({ rows: [{ ...row, kind: 'purchase' }] }).rows.length === 1;
      if (!validated) { skipped += 1; continue; }
      const latest = reconcileCardStatement([row], getCurrentTransactions(), selectedCardId)[0];
      if (match.kind === 'correction' && match.transaction) {
        if (latest.kind !== 'correction' || latest.transaction?.id !== match.transaction.id
          || latest.transaction.updatedAt !== match.transaction.updatedAt) { skipped += 1; continue; }
        try {
          const saved = onUpdate(match.transaction.id, match.transaction.updatedAt, {
            amount: row.amount,
            localDate: row.localDate,
            occurredAt: `${row.localDate}T12:00:00.000Z`,
            merchant: row.merchant,
            paymentMethodType: 'card',
            cardId: selectedCardId,
          });
          if (saved) corrected += 1;
          else skipped += 1;
        } catch { skipped += 1; }
        continue;
      }
      if (match.kind !== 'new' && match.kind !== 'review') { skipped += 1; continue; }
      if (latest.kind !== 'new') { skipped += 1; continue; }
      const categoryId = categoryByLine[row.line] || defaultCategoryId;
      if (!expenseCategories.some(category => category.id === categoryId)) { skipped += 1; continue; }
      try {
        onSave({
          type: 'expense',
          amount: row.amount,
          occurredAt: `${row.localDate}T12:00:00.000Z`,
          localDate: row.localDate,
          categoryId,
          merchant: row.merchant,
          memo: '카드 내역 대조로 등록',
          source: 'manual',
          paymentMethodType: 'card',
          accountId: null,
          cardId: selectedCardId,
        });
        added += 1;
      } catch { skipped += 1; }
    }
    setSelected(new Set());
    if (skipped === 0) {
      setParsed(null);
      setText('');
    }
    setResult(`새 거래 ${added}건 등록 · 기존 거래 ${corrected}건 수정${skipped ? ` · ${skipped}건은 내역 변경 또는 중복으로 건너뜀` : ''}`);
  };

  return (
    <details className="rounded-2xl border border-slate-700 bg-slate-900/70 p-3">
      <summary className="min-h-10 cursor-pointer py-2 text-sm font-bold text-slate-100">카드 내역 붙여넣어 보정하기</summary>
      <div className="mt-3 space-y-3 text-xs text-slate-300">
        <p>카드 앱 내역이나 엑셀 표를 붙여넣으면 GPT-6 Luna가 거래를 읽고 기존 기록과 대조합니다. 번호 정보는 전송 전 가리고, 확인한 항목만 등록·수정합니다.</p>
        {paymentCards.length > 0 && <label className="block space-y-1">
          <span>대조할 카드</span>
          <select value={cardId} disabled={isAnalyzing} onChange={event => { setCardId(event.target.value); setParsed(null); setSelected(new Set()); }} className="min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-white">
            {paymentCards.map(card => <option key={card.id} value={card.id}>{card.cardName}</option>)}
          </select>
        </label>}
        <textarea
          value={text}
          onChange={event => { setText(event.target.value.slice(0, 30_000)); setParsed(null); setResult(null); }}
          disabled={isAnalyzing}
          rows={5}
          maxLength={30_000}
          placeholder={'이용일자\t가맹점\t승인금액\n2026-10-08\t스타벅스\t5,000'}
          aria-label="카드 내역 붙여넣기"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white placeholder:text-slate-500"
        />
        <button type="button" onClick={() => { void analyze(); }} disabled={!text.trim() || isAnalyzing} className="min-h-10 rounded-lg bg-indigo-500 px-4 font-bold text-white disabled:opacity-40">{isAnalyzing ? 'AI가 내역 읽는 중…' : 'AI로 내역 대조'}</button>
        {error && <p role="alert" className="text-rose-300">{error}</p>}
        {result && <p role="status" className="text-emerald-300">{result}</p>}
        {parsed && <div className="space-y-2">
          <p className="font-bold text-white">AI가 읽은 거래 {parsed.rows.length}건 · 제외한 행 {parsed.issues.length}건</p>
          <p className="text-slate-400">AI가 읽은 날짜·사용처·금액을 확인하고, 잘못 읽은 값은 고친 뒤 선택하세요.</p>
          {matches.map(match => {
            const { row } = match;
            const actionable = match.kind === 'new' || match.kind === 'correction'
              || (match.kind === 'review' && match.reason?.startsWith('붙여넣은 내역에'));
            const label = match.kind === 'existing' ? '이미 등록됨'
              : match.kind === 'correction' ? `수정 후보 · 기존 ${match.transaction!.merchant} ${formatKRW(match.transaction!.amount)} → 카드 내역 ${row.merchant} ${formatKRW(row.amount)}${match.reason ? ` · ${match.reason}` : ''}`
                : match.kind === 'review' ? `중복 검토 · ${match.reason}` : '미등록';
            return <div key={row.line} className="rounded-xl border border-slate-700 bg-slate-950 p-2.5">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" disabled={!actionable} checked={selected.has(row.line)} onChange={event => {
                  setSelected(current => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(row.line); else next.delete(row.line);
                    return next;
                  });
                }} aria-label={`${row.line}행 ${label} 선택`} />
                <span className="min-w-0"><strong className="block text-white">{row.localDate} · {row.merchant} · {formatKRW(row.amount)}</strong><span className={match.kind === 'review' ? 'text-amber-300' : 'text-slate-400'}>{label}</span></span>
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2 pl-5">
                <label className="space-y-1"><span>날짜</span><input type="date" value={row.localDate} onChange={event => editRow(row.line, { localDate: event.target.value })} className="min-h-9 w-full rounded border border-slate-700 bg-slate-900 px-1 text-white" /></label>
                <label className="space-y-1"><span>금액</span><input type="number" min="1" step="1" value={row.amount} onChange={event => editRow(row.line, { amount: Number(event.target.value) })} className="min-h-9 w-full rounded border border-slate-700 bg-slate-900 px-1 text-white" /></label>
                <label className="col-span-2 space-y-1"><span>사용처</span><input type="text" value={row.merchant} maxLength={100} onChange={event => editRow(row.line, { merchant: event.target.value })} className="min-h-9 w-full rounded border border-slate-700 bg-slate-900 px-2 text-white" /></label>
              </div>
              {(match.kind === 'new' || match.kind === 'review') && <label className="mt-2 block space-y-1 pl-5">
                <span>등록 카테고리</span>
                <select value={categoryByLine[row.line] || defaultCategoryId} onChange={event => setCategoryByLine(current => ({ ...current, [row.line]: event.target.value }))} className="min-h-9 w-full rounded border border-slate-700 bg-slate-900 px-2 text-white">
                  {expenseCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>}
            </div>;
          })}
          {parsed.issues.slice(0, 10).map(issue => <p key={issue.line} className="text-amber-300">{issue.line}행: {issue.reason}</p>)}
          <button type="button" onClick={apply} disabled={selected.size === 0 || !defaultCategoryId} className="min-h-11 w-full rounded-lg bg-emerald-500 px-4 font-bold text-slate-950 disabled:opacity-40">선택한 {selected.size}건 등록·수정</button>
        </div>}
      </div>
    </details>
  );
};
