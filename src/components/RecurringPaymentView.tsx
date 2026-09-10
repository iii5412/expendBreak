import React, { useMemo, useState } from 'react';
import { AlertCircle, ArrowRightLeft, Check, CheckCircle2, ChevronDown, ChevronUp, Copy, CreditCard, Pencil, Receipt, RefreshCw, Wallet, X } from 'lucide-react';
import type { BankAccount, Category, PaymentCard, PaymentMethodType, RecurringOccurrence, RecurringTemplate } from '../types';
import { AccountingPeriod, MonthSummary, formatKRW, formatPeriodRange } from '../utils/calculations';
import type { MonthlyCardSettlement, MonthlyCardSettlementSummary } from '../utils/cardPayments';
import type { ManualCardSettlementCandidate } from '../utils/cardSettlementPlans';
import type { HiddenRecurringItem } from '../utils/hiddenRecurring';
import { buildPaydayTransferGroups, PaydayTransferGroup } from '../utils/paydayTransfers';
import { clearPaydayFunding, getLatestPaydayPaymentBatch, getPaydayFunding, markPaydayPaymentBatchUndone, savePaydayFunding, savePaydayPaymentBatch } from '../utils/paydayPaymentState';
import { AmountInput } from './ui/AmountInput';
import { useToast } from './ui/FeedbackProvider';
import { Modal } from './ui/Modal';
import { ScreenHeader } from './ui/ScreenHeader';

const HIDDEN_REASON_LABELS: Record<HiddenRecurringItem['reason'], string> = {
  card_settlement_replaced: '카드대금 자동 항목으로 대체', inactive: '사용 안 함', ended: '종료됨',
  not_started: '아직 시작하지 않음', other_cycle: '다른 주기의 일정', not_generated: '일정 미생성',
};

interface RecurringPaymentViewProps {
  period: AccountingPeriod;
  summary: MonthSummary;
  recurringOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  categories: Category[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  cardSettlementSummary: MonthlyCardSettlementSummary;
  hiddenExpenseItems: HiddenRecurringItem[];
  onCreateOccurrence: (templateId: string) => void;
  onReloadRecurringPlan: () => Promise<void>;
  duplicateManualCardSettlementCount: number;
  cardSettlementReviewItems: ManualCardSettlementCandidate[];
  onResolveCardSettlementReview: (templateId: string, cardId: string | null) => void;
  onUpdateCardSettlementStatus: (cardId: string, status: 'scheduled' | 'paid') => boolean | void | Promise<boolean | void>;
  onSaveCardSettlementAmount: (cardId: string, amount: number) => void;
  onPostOccurrence: (occId: string, customAmount?: number, customPaymentMethodType?: PaymentMethodType, customAccountId?: string | null, customCardId?: string | null) => boolean | void | Promise<boolean | void>;
  onUndoPostedOccurrence: (occurrenceId: string) => void;
  onUndoOccurrenceDirect: (occurrenceId: string) => boolean | void | Promise<boolean | void>;
  onExcludeOccurrence: (occurrenceId: string) => void;
  onUpdateOccurrencePlan: (occId: string, amount: number, paymentMethodType: PaymentMethodType, accountId: string | null, cardId: string | null) => void;
}

export const RecurringPaymentView: React.FC<RecurringPaymentViewProps> = ({
  period, summary, recurringOccurrences, recurringTemplates, categories, bankAccounts, paymentCards,
  cardSettlementSummary, hiddenExpenseItems, onCreateOccurrence, onReloadRecurringPlan,
  duplicateManualCardSettlementCount, cardSettlementReviewItems, onResolveCardSettlementReview,
  onUpdateCardSettlementStatus, onSaveCardSettlementAmount, onPostOccurrence, onUndoPostedOccurrence, onUndoOccurrenceDirect,
  onExcludeOccurrence, onUpdateOccurrencePlan,
}) => {
  const { showToast } = useToast();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [selectedGroup, setSelectedGroup] = useState<PaydayTransferGroup | null>(null);
  const [groupAction, setGroupAction] = useState<'fund' | 'pay' | 'undo'>('fund');
  const [fundingAmount, setFundingAmount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stateRevision, setStateRevision] = useState(0);
  const [selectedOcc, setSelectedOcc] = useState<RecurringOccurrence | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethodType, setPaymentMethodType] = useState<PaymentMethodType>('account');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedCardId, setSelectedCardId] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [itemQuery, setItemQuery] = useState('');
  const [editingCardBill, setEditingCardBill] = useState<MonthlyCardSettlement | null>(null);
  const [cardBillAmount, setCardBillAmount] = useState(0);

  const templateMap = useMemo(() => new Map(recurringTemplates.map(item => [item.id, item])), [recurringTemplates]);
  const categoryMap = useMemo(() => new Map(categories.map(item => [item.id, item])), [categories]);
  const accountMap = useMemo(() => new Map(bankAccounts.map(item => [item.id, item])), [bankAccounts]);
  const cardMap = useMemo(() => new Map(paymentCards.map(item => [item.id, item])), [paymentCards]);
  const visibleOccurrences = useMemo(() => recurringOccurrences.flatMap(occurrence => {
    if (occurrence.status === 'skipped') return [];
    const template = templateMap.get(occurrence.templateId);
    if (!template && occurrence.status !== 'posted') return [];
    return [{ occurrence, template, type: occurrence.typeSnapshot ?? template?.type ?? 'expense' }];
  }), [recurringOccurrences, templateMap]);
  const expenseOccurrences = visibleOccurrences.filter(item => item.type === 'expense').map(item => item.occurrence);
  const incomeOccurrences = visibleOccurrences.filter(item => item.type === 'income').map(item => item.occurrence);
  const transferGroups = useMemo(() => buildPaydayTransferGroups({
    recurringOccurrences: expenseOccurrences, recurringTemplates, bankAccounts, cardSettlements: cardSettlementSummary.cards,
  }), [expenseOccurrences, recurringTemplates, bankAccounts, cardSettlementSummary.cards]);

  const fundingFor = (group: PaydayTransferGroup) => {
    void stateRevision;
    return Math.min(group.pendingAmount, getPaydayFunding(period.yearMonth, group.key)?.amount || 0);
  };
  const sendable = (group: PaydayTransferGroup) => Boolean(group.accountId || group.accountNumber);
  const amountToSend = (group: PaydayTransferGroup) => sendable(group) ? Math.max(0, group.pendingAmount - fundingFor(group)) : 0;
  const totalExpected = transferGroups.reduce((sum, group) => sum + group.totalAmount, 0);
  const remainingTransferAmount = transferGroups.reduce((sum, group) => sum + amountToSend(group), 0);
  const unlinkedAmount = transferGroups.filter(group => !sendable(group)).reduce((sum, group) => sum + group.pendingAmount, 0);
  const needsAmountReview = (group: PaydayTransferGroup) => group.items.some(item => !item.completed && item.kind === 'card_settlement' && item.amount <= 0 && item.detail.startsWith('추정'));
  const isGroupComplete = (group: PaydayTransferGroup) => group.pendingAmount === 0 && !needsAmountReview(group);
  const actionGroups = transferGroups.filter(group => group.pendingAmount > 0 || needsAmountReview(group));
  const completedGroups = transferGroups.filter(isGroupComplete);
  const hasEstimatedCardBill = cardSettlementSummary.cards.some(card => card.source === 'estimated' && card.amount > 0);

  const toggleGroup = (key: string) => setExpandedGroups(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const copyText = async (value: string, message: string) => {
    try { await navigator.clipboard.writeText(value); showToast({ message, tone: 'success' }); }
    catch { showToast({ message: '복사하지 못했습니다.', tone: 'error' }); }
  };

  const openGroupAction = (group: PaydayTransferGroup, action: 'fund' | 'pay' | 'undo') => {
    setSelectedGroup(group);
    setGroupAction(action);
    setFundingAmount(action === 'fund' ? Math.max(fundingFor(group), group.pendingAmount) : fundingFor(group));
  };

  const handleGroupAction = async () => {
    if (!selectedGroup || isProcessing) return;
    setIsProcessing(true);
    try {
      if (groupAction === 'fund') {
        savePaydayFunding(period.yearMonth, selectedGroup.key, fundingAmount);
        setStateRevision(value => value + 1);
        setSelectedGroup(null);
        showToast({ message: `${selectedGroup.label} 이체 준비를 저장했습니다.`, description: `${formatKRW(fundingAmount)}을 납부용 금액으로 확보했습니다.`, tone: 'success' });
        return;
      }
      if (groupAction === 'undo') {
        const batch = getLatestPaydayPaymentBatch(period.yearMonth, selectedGroup.key);
        if (!batch) throw new Error('되돌릴 일괄 처리 기록이 없습니다.');
        for (const itemId of batch.itemIds) {
          const separator = itemId.indexOf(':');
          const kind = itemId.slice(0, separator);
          const referenceId = itemId.slice(separator + 1);
          const result = kind === 'card'
            ? await onUpdateCardSettlementStatus(referenceId, 'scheduled')
            : await onUndoOccurrenceDirect(referenceId);
          if (result === false) throw new Error('일부 항목을 되돌리지 못했습니다.');
        }
        markPaydayPaymentBatchUndone(batch.id);
        setStateRevision(value => value + 1);
        setSelectedGroup(null);
        showToast({ message: `${selectedGroup.label} 일괄 납부를 취소했습니다.`, tone: 'success' });
        return;
      }

      const pendingItems = selectedGroup.items.filter(item => !item.completed && item.amount > 0);
      if (pendingItems.length === 0 || pendingItems.some(item => !item.selectable)) {
        throw new Error(pendingItems.length ? '계좌나 금액을 먼저 확인해 주세요.' : '납부 처리할 항목이 없습니다.');
      }
      const completedIds: string[] = [];
      try {
        for (const item of pendingItems) {
          const result = item.kind === 'card_settlement'
            ? await onUpdateCardSettlementStatus(item.referenceId, 'paid')
            : await onPostOccurrence(item.referenceId, item.amount, 'account', item.accountId, null);
          if (result === false) throw new Error(`${item.label} 처리에 실패했습니다.`);
          completedIds.push(item.id);
        }
      } catch (error) {
        // The refreshed screen must be used for a retry so already-posted items
        // are not submitted again from this modal's stale snapshot.
        setSelectedGroup(null);
        throw error;
      } finally {
        if (completedIds.length > 0) {
          savePaydayPaymentBatch(period.yearMonth, selectedGroup.key, completedIds);
          const consumed = selectedGroup.items.filter(item => completedIds.includes(item.id)).reduce((sum, item) => sum + item.amount, 0);
          const remainingFunding = Math.max(0, fundingFor(selectedGroup) - consumed);
          if (remainingFunding) savePaydayFunding(period.yearMonth, selectedGroup.key, remainingFunding);
          else clearPaydayFunding(period.yearMonth, selectedGroup.key);
        }
      }
      setStateRevision(value => value + 1);
      setSelectedGroup(null);
      showToast({ message: `${selectedGroup.label} 납부를 완료했습니다.`, description: `고정지출과 카드대금 ${completedIds.length}건을 함께 처리했습니다.`, tone: 'success' });
    } catch (error) {
      showToast({ message: '계좌 처리를 완료하지 못했습니다.', description: error instanceof Error ? error.message : '잠시 후 다시 시도해 주세요.', tone: 'error' });
    } finally { setIsProcessing(false); }
  };

  const openOccurrence = (occurrence: RecurringOccurrence) => {
    const template = templateMap.get(occurrence.templateId);
    const isIncome = (occurrence.typeSnapshot ?? template?.type) === 'income';
    setSelectedOcc(occurrence);
    setPaymentAmount(occurrence.actualAmount ?? occurrence.expectedAmount ?? template?.defaultAmount ?? 0);
    setPaymentMethodType(occurrence.paymentMethodType ?? template?.paymentMethodType ?? 'account');
    setSelectedAccountId(occurrence.accountId ?? template?.accountId ?? '');
    setSelectedCardId(occurrence.cardId ?? template?.cardId ?? '');
    setPaymentError(null);
  };
  const validateOccurrence = (allowZero: boolean) => {
    if ((!allowZero && paymentAmount <= 0) || paymentAmount < 0) {
      setPaymentError(allowZero ? '예정 금액은 0원 이상이어야 합니다.' : '납부 금액은 0원보다 커야 합니다.'); return false;
    }
    if (paymentMethodType === 'card' && !selectedCardId) { setPaymentError('카드대금에 반영할 카드를 선택해 주세요.'); return false; }
    setPaymentError(null); return true;
  };
  const handleSavePlan = () => {
    if (!selectedOcc || !validateOccurrence(true)) return;
    onUpdateOccurrencePlan(selectedOcc.id, paymentAmount, paymentMethodType, paymentMethodType === 'account' ? selectedAccountId || null : null, paymentMethodType === 'card' ? selectedCardId || null : null);
    setSelectedOcc(null); showToast({ message: '이번 주기 계획을 수정했습니다.', tone: 'success' });
  };
  const handlePostOccurrence = async () => {
    if (!selectedOcc || !validateOccurrence(false)) return;
    const result = await onPostOccurrence(selectedOcc.id, paymentAmount, paymentMethodType, paymentMethodType === 'account' ? selectedAccountId || null : null, paymentMethodType === 'card' ? selectedCardId || null : null);
    if (result === false) { setPaymentError('항목을 처리하지 못했습니다. 계좌와 금액을 확인해 주세요.'); return; }
    setSelectedOcc(null);
  };

  const renderGroup = (group: PaydayTransferGroup) => {
    const expanded = expandedGroups.has(group.key);
    const funded = fundingFor(group);
    const toSend = amountToSend(group);
    const fixedCount = group.items.filter(item => item.kind === 'recurring').length;
    const cardCount = group.items.filter(item => item.kind === 'card_settlement').length;
    const blockingCount = group.items.filter(item => !item.completed && item.amount > 0 && !item.selectable).length;
    const latestBatch = getLatestPaydayPaymentBatch(period.yearMonth, group.key);
    const requiresAmount = needsAmountReview(group);
    const complete = isGroupComplete(group);
    return (
      <article key={group.key} className={`overflow-hidden rounded-2xl border ${complete ? 'border-emerald-500/25 bg-emerald-500/5' : sendable(group) && !requiresAmount ? 'border-slate-700 bg-slate-900/85' : 'border-amber-500/35 bg-amber-500/5'}`}>
        <button type="button" onClick={() => toggleGroup(group.key)} aria-expanded={expanded} className="flex min-h-16 w-full items-start justify-between gap-3 p-4 text-left">
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-extrabold text-slate-100">{group.label}</span>
              {complete && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">{group.totalAmount === 0 ? '납부 없음' : '납부 완료'}</span>}
              {requiresAmount && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">금액 확인 필요</span>}
              {funded > 0 && group.pendingAmount > 0 && <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold text-blue-300">이체 준비 {funded >= group.pendingAmount ? '완료' : '일부'}</span>}
            </span>
            <span className="mt-1 block text-xs text-slate-400">고정지출 {fixedCount}건{cardCount ? ` · 카드대금 ${cardCount}건` : ''}{!sendable(group) ? ' · 계좌 확인 필요' : ''}</span>
          </span>
          <span className="flex shrink-0 items-start gap-2">
            <span className="text-right"><span className="block text-[11px] text-slate-400">{group.pendingAmount ? '보낼 금액' : '이번 주기 납부액'}</span><span className={`eb-tabular block text-lg font-extrabold ${group.pendingAmount ? 'text-amber-300' : 'text-emerald-300'}`}>{formatKRW(group.pendingAmount ? toSend : group.totalAmount)}</span></span>
            {expanded ? <ChevronUp className="mt-1 h-4 w-4 text-slate-500" /> : <ChevronDown className="mt-1 h-4 w-4 text-slate-500" />}
          </span>
        </button>
        {expanded && <div className="border-t border-slate-800 px-4 pb-4">
          <dl className="grid grid-cols-2 gap-2 py-3 text-xs">
            <div className="rounded-xl bg-slate-950/60 p-3"><dt className="text-slate-500">이번 주기 납부액</dt><dd className="mt-1 font-bold text-slate-100">{formatKRW(group.totalAmount)}</dd></div>
            <div className="rounded-xl bg-slate-950/60 p-3"><dt className="text-slate-500">확보한 금액</dt><dd className="mt-1 font-bold text-blue-300">{formatKRW(funded)}</dd></div>
          </dl>
          <ul className="divide-y divide-slate-800 border-y border-slate-800">
            {group.items.map(item => <li key={item.id} className="flex items-center justify-between gap-3 py-3 text-xs">
              <span className="min-w-0"><span className={`block truncate font-semibold ${item.completed ? 'text-emerald-300' : 'text-slate-200'}`}>{item.label}</span><span className="mt-0.5 block text-[11px] text-slate-500">{item.detail}{item.dueDate ? ` · ${item.dueDate}` : ''}{item.completed ? ' · 완료' : item.amount <= 0 ? ' · 금액 확인 필요' : ''}</span></span>
              <span className="flex shrink-0 items-center gap-2"><span className="font-bold text-slate-100">{formatKRW(item.amount)}</span>{item.kind === 'card_settlement' && !item.completed && <button type="button" aria-label={`${item.label} 금액 수정`} onClick={() => { const card = cardSettlementSummary.cards.find(candidate => candidate.cardId === item.referenceId); if (card) { setEditingCardBill(card); setCardBillAmount(card.amount); } }} className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-blue-300"><Pencil className="h-3.5 w-3.5" /></button>}</span>
            </li>)}
          </ul>
          {group.accountNumber && <p className="mt-3 text-xs text-slate-400">{group.bankName} {group.accountNumber}{group.accountHolder ? ` · ${group.accountHolder}` : ''}</p>}
          {blockingCount > 0 && <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">계좌 또는 금액을 확인해야 하는 항목 {blockingCount}건이 있어 전체 납부처리를 할 수 없습니다.</p>}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
            {group.accountNumber && <button type="button" onClick={() => void copyText(group.accountNumber, '계좌번호를 복사했습니다.')} className="min-h-10 rounded-xl border border-slate-700 px-3 text-xs font-bold text-slate-300 hover:bg-slate-800"><Copy className="mr-1 inline h-3.5 w-3.5" />계좌번호</button>}
            {toSend > 0 && <button type="button" onClick={() => void copyText(String(toSend), '이체 금액을 복사했습니다.')} className="min-h-10 rounded-xl border border-slate-700 px-3 text-xs font-bold text-slate-300 hover:bg-slate-800"><Copy className="mr-1 inline h-3.5 w-3.5" />금액</button>}
            {group.pendingAmount > 0 && sendable(group) && <button type="button" onClick={() => openGroupAction(group, 'fund')} className="min-h-10 rounded-xl border border-blue-500/35 bg-blue-500/10 px-3 text-xs font-bold text-blue-200 hover:bg-blue-500/20"><ArrowRightLeft className="mr-1 inline h-3.5 w-3.5" />이체 준비</button>}
            {group.pendingAmount > 0 && <button type="button" disabled={!sendable(group) || blockingCount > 0} onClick={() => openGroupAction(group, 'pay')} className="min-h-10 flex-1 rounded-xl bg-emerald-500 px-3 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"><Check className="mr-1 inline h-3.5 w-3.5" />계좌 납부처리</button>}
            {latestBatch && <button type="button" onClick={() => openGroupAction(group, 'undo')} className="min-h-10 flex-1 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 text-xs font-bold text-amber-200 hover:bg-amber-500/20"><RefreshCw className="mr-1 inline h-3.5 w-3.5" />{complete ? '일괄 납부 취소' : '최근 처리 취소'}</button>}
          </div>
        </div>}
      </article>
    );
  };

  const normalizedQuery = itemQuery.trim().toLocaleLowerCase('ko-KR');
  const detailedOccurrences = visibleOccurrences.filter(({ occurrence, template }) => {
    if (!normalizedQuery) return true;
    const account = accountMap.get(occurrence.accountId ?? template?.accountId ?? '');
    return [template?.name, template?.counterparty, account?.accountName, categoryMap.get(template?.categoryId || '')?.name].some(value => value?.toLocaleLowerCase('ko-KR').includes(normalizedQuery));
  });

  return <div className="space-y-5 pb-20">
    <ScreenHeader eyebrow="Payday payments" title="정기납부" description="급여일에 계좌별로 보낼 돈을 확인하고 한 번에 처리하세요." icon={<Receipt className="h-4 w-4" />} meta={<span>{period.yearMonth.replace('-', '년 ')}월 주기{formatPeriodRange(period) ? ` · ${formatPeriodRange(period)}` : ''}</span>} actions={<button type="button" onClick={async () => { setIsReloading(true); try { await onReloadRecurringPlan(); } finally { setIsReloading(false); } }} disabled={isReloading} className="inline-flex min-h-10 items-center gap-1.5 border border-slate-700 bg-slate-900 px-3 text-xs font-bold text-slate-200 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isReloading ? 'animate-spin' : ''}`} />{isReloading ? '불러오는 중' : '계획 새로 불러오기'}</button>} />

    <section className="overflow-hidden rounded-2xl border border-amber-400/25 bg-gradient-to-br from-slate-900 to-amber-950/20 p-5" aria-label="이번 주기 납부 요약">
      <p className="text-xs font-bold text-amber-200">이번 주기 총 지출예정액</p><p className="eb-tabular mt-1 text-3xl font-black tracking-tight text-white">{formatKRW(totalExpected)}</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-slate-700/70 pt-4"><div><p className="text-xs text-slate-400">남은 이체액</p><p className="eb-tabular text-xl font-extrabold text-amber-300">{formatKRW(remainingTransferAmount)}</p></div><p className="text-xs text-slate-400">처리할 계좌 {actionGroups.length}개 · 납부 완료 {completedGroups.length}개</p></div>
      {hasEstimatedCardBill && <p className="mt-3 text-xs text-blue-200">추정 카드대금이 포함되어 있습니다. 청구액 확정 시 차액을 다시 계산합니다.</p>}
      {unlinkedAmount > 0 && <p className="mt-2 text-xs font-semibold text-amber-200">계좌 확인이 필요한 별도 납부 {formatKRW(unlinkedAmount)}</p>}
    </section>

    <section className="space-y-3" aria-labelledby="account-payments-title"><div><h2 id="account-payments-title" className="text-base font-extrabold text-slate-100">계좌별 이체</h2><p className="mt-0.5 text-xs text-slate-400">계좌를 펼치면 연결된 고정지출과 카드대금을 볼 수 있습니다.</p></div>
      {transferGroups.length ? transferGroups.map(renderGroup) : <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">이번 주기에 처리할 정기 지출이 없습니다.</div>}
    </section>

    <details className="rounded-2xl border border-slate-800 bg-slate-900/55"><summary className="cursor-pointer list-none p-4 text-sm font-bold text-slate-200">정기 수입 {incomeOccurrences.length}건 · 전체 항목 관리</summary><div className="space-y-4 border-t border-slate-800 p-4">
      <input type="search" value={itemQuery} onChange={event => setItemQuery(event.target.value)} placeholder="항목명·계좌·카테고리 검색" className="min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 outline-none focus:border-blue-500" />
      <ul className="space-y-2">{detailedOccurrences.map(({ occurrence, template, type }) => {
        const method = occurrence.paymentMethodType ?? template?.paymentMethodType ?? 'account';
        const account = accountMap.get(occurrence.accountId ?? template?.accountId ?? ''); const card = cardMap.get(occurrence.cardId ?? template?.cardId ?? '');
        return <li key={occurrence.id} className="rounded-xl border border-slate-800 bg-slate-950/55 p-3 text-xs"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="font-bold text-slate-100">{template?.name || '삭제된 정기 항목'}</span>{method === 'card' && <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-bold text-blue-300">카드대금에 포함</span>}{occurrence.status === 'posted' && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">완료</span>}</div><p className="mt-1 text-slate-500">{occurrence.scheduledDate} · {account ? `${account.accountName} · ${account.bankName}` : card?.cardName || '결제수단 미지정'}</p></div><span className="shrink-0 font-bold text-slate-100">{formatKRW(occurrence.actualAmount ?? occurrence.expectedAmount)}</span></div><div className="mt-2 flex justify-end gap-2">{occurrence.status === 'posted' ? <button type="button" onClick={() => onUndoPostedOccurrence(occurrence.id)} className="min-h-9 rounded-lg border border-amber-500/30 px-2.5 font-bold text-amber-200">완료 취소</button> : <><button type="button" onClick={() => onExcludeOccurrence(occurrence.id)} className="min-h-9 rounded-lg border border-slate-700 px-2.5 font-bold text-slate-400">이번 주기 제외</button><button type="button" onClick={() => openOccurrence(occurrence)} className="min-h-9 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 font-bold text-blue-200"><Pencil className="mr-1 inline h-3.5 w-3.5" />수정·처리</button></>}</div></li>;
      })}</ul>
      {summary.cardFixedExpenses > 0 && <p className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-200">카드 결제 고정비 {formatKRW(summary.cardFixedExpenses)}은 카드대금에 포함되므로 계좌별 합계에 다시 더하지 않습니다.</p>}
      {cardSettlementReviewItems.length > 0 && <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"><p className="text-xs font-bold text-amber-200"><AlertCircle className="mr-1 inline h-3.5 w-3.5" />카드대금 중복 여부 확인</p>{cardSettlementReviewItems.map(item => <div key={item.templateId} className="rounded-lg bg-slate-950/60 p-2.5 text-xs"><p className="font-bold text-slate-100">{item.templateName} · {item.cardName}</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => onResolveCardSettlementReview(item.templateId, item.cardId)} className="min-h-9 flex-1 rounded-lg bg-amber-500 font-bold text-slate-950">카드대금 맞음</button><button type="button" onClick={() => onResolveCardSettlementReview(item.templateId, null)} className="min-h-9 flex-1 rounded-lg border border-slate-700 font-bold text-slate-300">별개 지출</button></div></div>)}</div>}
      {hiddenExpenseItems.length > 0 && <details className="rounded-xl border border-slate-800"><summary className="cursor-pointer list-none p-3 text-xs font-bold text-slate-300">이번 주기 목록에 없는 고정지출 {hiddenExpenseItems.length}건</summary><ul className="space-y-2 border-t border-slate-800 p-3">{hiddenExpenseItems.map(item => <li key={item.templateId} className="rounded-lg bg-slate-950/60 p-2.5 text-xs"><div className="flex justify-between gap-3"><span className="font-bold text-slate-200">{item.name}</span><span>{formatKRW(item.amount)}</span></div><p className="mt-1 text-slate-500">{HIDDEN_REASON_LABELS[item.reason]}</p>{!['inactive', 'ended', 'card_settlement_replaced'].includes(item.reason) && <button type="button" onClick={() => onCreateOccurrence(item.templateId)} className="mt-2 min-h-9 w-full rounded-lg border border-emerald-500/30 font-bold text-emerald-300">이번 주기 일정 만들기</button>}</li>)}</ul></details>}
      {duplicateManualCardSettlementCount > 0 && <p className="text-xs text-slate-500">수동 카드대금 {duplicateManualCardSettlementCount}건은 자동 카드대금으로 대체되어 합계에서 제외됩니다.</p>}
    </div></details>

    <Modal isOpen={Boolean(selectedGroup)} onClose={() => !isProcessing && setSelectedGroup(null)} labelledById="group-action-title" dismissOnBackdrop={!isProcessing}>{selectedGroup && <div className="space-y-4 text-slate-100"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-blue-300">{selectedGroup.label}</p><h3 id="group-action-title" className="mt-1 text-lg font-extrabold">{groupAction === 'fund' ? '이체 준비 확인' : groupAction === 'pay' ? '계좌 납부처리' : '일괄 납부 취소'}</h3></div><button type="button" disabled={isProcessing} onClick={() => setSelectedGroup(null)} aria-label="닫기" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"><X className="h-4 w-4" /></button></div>
      {groupAction === 'fund' ? <div><label htmlFor="group-funding-amount" className="mb-1 block text-xs font-semibold text-slate-300">이 계좌에 납부용으로 확보한 금액</label><AmountInput id="group-funding-amount" value={fundingAmount} onChange={setFundingAmount} showQuickAdd /><p className="mt-2 text-xs leading-relaxed text-slate-400">실제 계좌 잔액 전체가 아닌, 이번 주기 납부에 쓸 수 있는 금액만 입력합니다. 저장해도 실제 납부 완료로 바뀌지 않습니다.</p></div> : groupAction === 'pay' ? <><div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"><p className="text-xs text-slate-400">한 번에 납부 완료할 금액</p><p className="eb-tabular mt-1 text-2xl font-black text-emerald-300">{formatKRW(selectedGroup.pendingAmount)}</p></div><p className="text-xs leading-relaxed text-slate-300">이 계좌에 연결된 미납부 고정지출과 카드대금을 모두 완료 처리합니다. 카드대금은 정산 거래로 기록되어 생활비 소비에 다시 더해지지 않습니다.</p></> : <p className="text-sm leading-relaxed text-slate-300">이 화면에서 마지막으로 함께 처리한 항목만 미납부 상태로 되돌립니다. 이전에 개별 완료한 항목은 유지됩니다.</p>}
      <div className="flex gap-2 border-t border-slate-800 pt-4"><button type="button" disabled={isProcessing} onClick={() => setSelectedGroup(null)} className="min-h-11 flex-1 rounded-xl border border-slate-700 font-bold text-slate-300">취소</button><button type="button" data-autofocus disabled={isProcessing || (groupAction === 'fund' && fundingAmount < 0)} onClick={() => void handleGroupAction()} className={`min-h-11 flex-[1.4] rounded-xl font-extrabold ${groupAction === 'undo' ? 'bg-amber-500' : 'bg-emerald-500'} text-slate-950 disabled:opacity-50`}>{isProcessing ? '처리 중…' : groupAction === 'fund' ? '이체 준비 저장' : groupAction === 'pay' ? '모두 납부 완료' : '일괄 처리 취소'}</button></div>
    </div>}</Modal>

    <Modal isOpen={Boolean(selectedOcc)} onClose={() => setSelectedOcc(null)} labelledById="occurrence-edit-title">{selectedOcc && (() => { const template = templateMap.get(selectedOcc.templateId); const isIncome = (selectedOcc.typeSnapshot ?? template?.type) === 'income'; return <div className="space-y-4 text-slate-100"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-slate-400">{template?.name || '정기 항목'}</p><h3 id="occurrence-edit-title" className="mt-1 text-lg font-extrabold">이번 주기 금액·결제수단</h3></div><button type="button" onClick={() => setSelectedOcc(null)} aria-label="닫기" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"><X className="h-4 w-4" /></button></div>
      <div><label htmlFor="occurrence-amount" className="mb-1 block text-xs font-semibold text-slate-300">{isIncome ? '입금 금액' : '납부 금액'}</label><AmountInput id="occurrence-amount" value={paymentAmount} onChange={value => { setPaymentAmount(value); setPaymentError(null); }} showQuickAdd invalid={Boolean(paymentError)} />{paymentError && <p role="alert" className="mt-1 text-xs font-semibold text-rose-300">{paymentError}</p>}</div>
      <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setPaymentMethodType('account')} className={`min-h-10 rounded-xl border text-xs font-bold ${paymentMethodType === 'account' ? 'border-blue-500 bg-blue-500/15 text-blue-200' : 'border-slate-700 text-slate-400'}`}><Wallet className="mr-1 inline h-4 w-4" />계좌</button>{!isIncome && <button type="button" onClick={() => setPaymentMethodType('card')} className={`min-h-10 rounded-xl border text-xs font-bold ${paymentMethodType === 'card' ? 'border-blue-500 bg-blue-500/15 text-blue-200' : 'border-slate-700 text-slate-400'}`}><CreditCard className="mr-1 inline h-4 w-4" />카드</button>}</div>
      {paymentMethodType === 'account' ? <select value={selectedAccountId} onChange={event => setSelectedAccountId(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm"><option value="">계좌 미지정</option>{bankAccounts.map(account => <option key={account.id} value={account.id}>{account.accountName} · {account.bankName}</option>)}</select> : <select value={selectedCardId} onChange={event => setSelectedCardId(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm"><option value="">카드 선택</option>{paymentCards.map(card => <option key={card.id} value={card.id}>{card.cardName} · {card.cardCompany}</option>)}</select>}
      <div className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-4"><button type="button" onClick={handleSavePlan} className="min-h-11 rounded-xl border border-blue-500/30 bg-blue-500/10 text-xs font-bold text-blue-200"><Pencil className="mr-1 inline h-4 w-4" />계획만 저장</button><button type="button" onClick={() => void handlePostOccurrence()} className="min-h-11 rounded-xl bg-emerald-500 text-xs font-extrabold text-slate-950"><CheckCircle2 className="mr-1 inline h-4 w-4" />{isIncome ? '입금 완료' : '납부 완료'}</button></div>
    </div>; })()}</Modal>

    <Modal isOpen={Boolean(editingCardBill)} onClose={() => setEditingCardBill(null)} labelledById="card-bill-edit-title">{editingCardBill && <div className="space-y-4 text-slate-100"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-blue-300">{editingCardBill.cardName}</p><h3 id="card-bill-edit-title" className="mt-1 text-lg font-extrabold">카드대금 확인</h3></div><button type="button" onClick={() => setEditingCardBill(null)} aria-label="닫기" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"><X className="h-4 w-4" /></button></div><div><label htmlFor="card-bill-amount" className="mb-1 block text-xs font-semibold text-slate-300">이번 결제분 확정 금액</label><AmountInput id="card-bill-amount" value={cardBillAmount} onChange={setCardBillAmount} showQuickAdd /><p className="mt-2 text-xs text-slate-400">0원으로 저장하면 확정된 납부 없음으로 표시하며 0원 거래는 만들지 않습니다.</p></div><button type="button" onClick={() => { onSaveCardSettlementAmount(editingCardBill.cardId, cardBillAmount); setEditingCardBill(null); }} className="min-h-11 w-full rounded-xl bg-blue-500 text-sm font-extrabold text-white">확정 금액 저장</button></div>}</Modal>
  </div>;
};
