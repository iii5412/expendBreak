import React, { useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  Receipt,
  CreditCard,
  Wallet,
  ArrowRightLeft,
  DollarSign,
  Check,
  ChevronDown,
  ChevronUp,
  X,
  TrendingUp,
  TrendingDown,
  RefreshCw,
} from 'lucide-react';
import {
  BankAccount,
  Category,
  PaymentCard,
  PaymentMethodType,
  RecurringOccurrence,
  RecurringTemplate
} from '../types';
import { AccountingPeriod, MonthSummary, formatKRW, formatPeriodRange } from '../utils/calculations';
import { Modal } from './ui/Modal';
import { AmountInput } from './ui/AmountInput';
import { MonthlyCardSettlementSummary } from '../utils/cardPayments';
import { ManualCardSettlementCandidate } from '../utils/cardSettlementPlans';
import { HiddenRecurringItem } from '../utils/hiddenRecurring';
import { CategoryIcon } from './ui/CategoryIcon';

/** Why a registered fixed expense produces no row in the selected cycle. */
const HIDDEN_REASON_LABELS: Record<HiddenRecurringItem['reason'], string> = {
  card_settlement_replaced: '카드대금 자동 항목으로 대체',
  inactive: '사용 안 함으로 꺼둠',
  ended: '종료일이 지난 항목',
  not_started: '다음 주기부터 반영',
  other_cycle: '이번 주기에 해당하는 회차 없음',
  not_generated: '일정이 아직 생성되지 않음',
};

interface RecurringPaymentViewProps {
  /** Period comes from the app-wide selector; this view no longer owns month state. */
  period: AccountingPeriod;
  /** Single source of truth for cash-track totals. */
  summary: MonthSummary;
  recurringOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  categories: Category[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  cardSettlementSummary: MonthlyCardSettlementSummary;
  /** Registered fixed expenses with no row in this cycle, and why. */
  hiddenExpenseItems: HiddenRecurringItem[];
  onReloadRecurringPlan: () => Promise<void>;
  duplicateManualCardSettlementCount: number;
  /** Items that look like a card bill but are still counted as a transfer. */
  cardSettlementReviewItems: ManualCardSettlementCandidate[];
  onResolveCardSettlementReview: (templateId: string, cardId: string | null) => void;
  onUpdateCardSettlementStatus: (cardId: string, status: 'scheduled' | 'paid') => void;
  onPostOccurrence: (
    occId: string,
    customAmount?: number,
    customPaymentMethodType?: PaymentMethodType,
    customAccountId?: string | null,
    customCardId?: string | null
  ) => void;
  onUpdateOccurrenceStatus: (occId: string, status: any) => void;
  onUpdateOccurrencePlan: (
    occId: string,
    amount: number,
    paymentMethodType: PaymentMethodType,
    accountId: string | null,
    cardId: string | null,
  ) => void;
}

export const RecurringPaymentView: React.FC<RecurringPaymentViewProps> = ({
  period,
  summary,
  recurringOccurrences,
  recurringTemplates,
  categories,
  bankAccounts,
  paymentCards,
  cardSettlementSummary,
  hiddenExpenseItems,
  onReloadRecurringPlan,
  duplicateManualCardSettlementCount,
  cardSettlementReviewItems,
  onResolveCardSettlementReview,
  onUpdateCardSettlementStatus,
  onPostOccurrence,
  onUpdateOccurrenceStatus,
  onUpdateOccurrencePlan,
}) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'posted' | 'expense' | 'income'>('pending');

  // Modal State for Confirming Payment / Income
  const [selectedOcc, setSelectedOcc] = useState<RecurringOccurrence | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethodType, setPaymentMethodType] = useState<PaymentMethodType>('account');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedCardId, setSelectedCardId] = useState<string>('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [showHiddenItems, setShowHiddenItems] = useState(false);

  const periodRange = formatPeriodRange(period);
  const templateMap = new Map<string, RecurringTemplate>(recurringTemplates.map((t) => [t.id, t]));
  const categoryMap = new Map<string, Category>(categories.map((c) => [c.id, c]));
  const accountMap = new Map<string, BankAccount>(bankAccounts.map((a) => [a.id, a]));
  const cardMap = new Map<string, PaymentCard>(paymentCards.map((c) => [c.id, c]));


  // Open Payment Confirmation Modal
  const handleOpenPaymentModal = (occ: RecurringOccurrence) => {
    setSelectedOcc(occ);
    const tmpl = templateMap.get(occ.templateId);

    const amount = occ.actualAmount ?? occ.expectedAmount ?? tmpl?.defaultAmount ?? 0;
    setPaymentAmount(amount);

    const isIncome = (occ.typeSnapshot ?? tmpl?.type) === 'income';
    const defaultPType = occ.paymentMethodType || tmpl?.paymentMethodType || (isIncome ? 'account' : 'card');
    setPaymentMethodType(defaultPType);

    const accId = occ.accountId || tmpl?.accountId || bankAccounts[0]?.id || '';
    setSelectedAccountId(accId);

    const cardId = occ.cardId || tmpl?.cardId || paymentCards[0]?.id || '';
    setSelectedCardId(cardId);
  };

  // Confirm Payment
  const handleConfirmPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOcc) return;

    if (paymentAmount <= 0) {
      setPaymentError('금액은 0원보다 커야 합니다.');
      document.getElementById('occurrence-amount')?.focus();
      return;
    }
    setPaymentError(null);

    onPostOccurrence(
      selectedOcc.id,
      paymentAmount,
      paymentMethodType,
      paymentMethodType === 'account' ? selectedAccountId : null,
      paymentMethodType === 'card' ? selectedCardId : null
    );

    setSelectedOcc(null);
  };

  const handleSaveMonthlyPlan = () => {
    if (!selectedOcc) return;
    if (paymentAmount < 0) {
      setPaymentError('이번 달 예정 금액은 0원 이상이어야 합니다.');
      return;
    }
    if (paymentMethodType === 'card' && paymentCards.length > 0 && !selectedCardId) {
      setPaymentError('카드대금에 반영할 카드를 선택해 주세요.');
      return;
    }
    setPaymentError(null);
    onUpdateOccurrencePlan(
      selectedOcc.id,
      paymentAmount,
      paymentMethodType,
      paymentMethodType === 'account' ? selectedAccountId || null : null,
      paymentMethodType === 'card' ? selectedCardId || null : null,
    );
    setSelectedOcc(null);
  };

  // Map Occurrences with template type
  // The snapshot leads: an occurrence whose template was deleted still knows
  // what it was, and the month summary already reads it that way. Falling back
  // to the template alone filed a posted salary under 고정 지출.
  const occurrencesWithTemplates = recurringOccurrences.map((occ) => {
    const tmpl = templateMap.get(occ.templateId);
    const type = occ.typeSnapshot ?? tmpl?.type ?? 'expense';
    return { ...occ, type, tmpl };
  });

  const incomeOccurrences = occurrencesWithTemplates.filter((o) => o.type === 'income');
  const expenseOccurrences = occurrencesWithTemplates.filter((o) => o.type === 'expense');

  const totalScheduledIncome = incomeOccurrences.filter(o => o.status !== 'skipped').reduce(
    (sum, o) => sum + (o.actualAmount ?? o.expectedAmount),
    0
  );
  const totalPostedIncome = incomeOccurrences
    .filter((o) => o.status === 'posted')
    .reduce((sum, o) => sum + (o.actualAmount ?? o.expectedAmount), 0);
  const pendingIncomeAmount = totalScheduledIncome - totalPostedIncome;

  // Fixed-outflow totals come from the shared cash-track model so this screen,
  // the dashboard and settings cannot drift apart.
  const totalScheduledExpense = summary.accountFixedOutflow + summary.cardSettlementOutflow;
  const postedCardSettlementAmount = cardSettlementSummary.cards
    .filter(card => card.status === 'paid')
    .reduce((sum, card) => sum + card.amount, 0);
  const totalPostedExpense = summary.confirmedAccountFixedOutflow + postedCardSettlementAmount;
  const pendingExpenseAmount = totalScheduledExpense - totalPostedExpense;
  const cardSettlementItems = cardSettlementSummary.cards;
  const pendingCardSettlementCount = cardSettlementItems.filter(card => card.status !== 'paid').length;
  const paidCardSettlementCount = cardSettlementItems.filter(card => card.status === 'paid').length;
  // Cards with different billing days can charge different usage months.
  const cardBillUsageMonths = [...new Set(cardSettlementItems.map(card => card.usageYearMonth))];
  const cardBillUsageLabel = cardBillUsageMonths.length === 1 ? cardBillUsageMonths[0] : '직전 사용월';

  const handleReload = async () => {
    setIsReloading(true);
    try {
      await onReloadRecurringPlan();
    } finally {
      setIsReloading(false);
    }
  };

  // Filter Occurrences
  const filteredOccurrences = occurrencesWithTemplates.filter((occ) => {
    if (filterStatus === 'pending') return occ.status !== 'posted' && occ.status !== 'skipped';
    if (filterStatus === 'posted') return occ.status === 'posted';
    if (filterStatus === 'income') return occ.type === 'income';
    if (filterStatus === 'expense') return occ.type === 'expense';
    return true;
  });

  return (
    <div className="space-y-6 pb-20">
      {/* Month & Title Bar */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Receipt className="w-6 h-6 text-emerald-400" />
            정기 수입 · 지출 관리 센터
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            급여 등 고정 수입과 월별 고정지출을 처리하고, 전월 카드 사용액을 이번 달 결제계좌 출금액으로 함께 확인합니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs">
            <span className="font-bold text-white">{period.yearMonth.replace('-', '년 ')}월</span>
            {periodRange && <span className="ml-1.5 text-slate-400">{periodRange}</span>}
          </div>
          <button
            type="button"
            onClick={() => void handleReload()}
            disabled={isReloading}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 text-xs font-bold text-indigo-200 transition-colors hover:bg-indigo-500/20 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isReloading ? 'animate-spin' : ''}`} />
            {isReloading ? '불러오는 중...' : '고정 지출 새로 불러오기'}
          </button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
              <TrendingUp className="w-4 h-4" />
              월 고정 수입 예정액
            </span>
            <span className="text-xs text-emerald-400/80 font-medium">입금 완료: {formatKRW(totalPostedIncome)}</span>
          </div>
          <p className="text-xl font-extrabold text-emerald-400 mt-1">{formatKRW(totalScheduledIncome)}</p>
          <p className="text-xs text-slate-400 mt-1">
            남은 입금 예정: <strong className="text-emerald-300">{formatKRW(pendingIncomeAmount)}</strong>
          </p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-rose-400 text-xs font-semibold">
              <TrendingDown className="w-4 h-4" />
              이번 달 고정 출금 예정액
            </span>
            <span className="text-xs text-slate-400 font-medium">납부 완료: {formatKRW(totalPostedExpense)}</span>
          </div>
          <p className="text-xl font-extrabold text-white mt-1">{formatKRW(totalScheduledExpense)}</p>
          <p className="text-xs text-slate-400 mt-1">
            남은 납부 예정: <strong className="text-amber-300">{formatKRW(pendingExpenseAmount)}</strong>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            계좌 이체 {formatKRW(summary.accountFixedOutflow)} + 카드대금 {formatKRW(summary.cardSettlementOutflow)}
          </p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold">
            <Clock className="w-4 h-4" />
            미처리 항목 건수
          </div>
          <p className="text-xl font-extrabold text-indigo-300 mt-1">
            {recurringOccurrences.filter((o) => o.status !== 'posted' && o.status !== 'skipped').length + pendingCardSettlementCount}건
          </p>
          <p className="text-xs text-slate-400 mt-1">
            수입 {incomeOccurrences.filter(o => o.status !== 'posted' && o.status !== 'skipped').length}건 / 지출 {expenseOccurrences.filter(o => o.status !== 'posted' && o.status !== 'skipped').length + pendingCardSettlementCount}건 대기 중
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-indigo-500/25 bg-indigo-500/5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-indigo-200">
              <CreditCard className="h-4 w-4" />
              자동 생성 카드대금 고정출금 항목
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              결제일이 {period.yearMonth} 주기 안에 있는 카드대금입니다. {cardBillUsageLabel} 사용분과 카드 결제 고정지출을 합산하며, 카드 사용 거래를 다시 지출로 중복 저장하지 않고 결제계좌에서 확보할 출금액으로만 반영합니다.
            </p>
          </div>
          <span className="shrink-0 text-base font-extrabold text-indigo-300">{formatKRW(cardSettlementSummary.linkedAccountTotal)}</span>
        </div>

        {cardSettlementItems.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
            등록된 신용카드가 없습니다. 카드와 결제계좌를 연결하면 월별 카드대금 항목이 자동 생성됩니다.
          </p>
        ) : (
          <div className="space-y-2">
            {cardSettlementItems.map(card => {
              const linkedAccount = card.linkedAccountId
                ? accountMap.get(card.linkedAccountId)
                : undefined;
              return (
                <div key={card.cardId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-slate-100">{card.cardName} 카드대금</span>
                      <span className="rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-200">자동 생성</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${card.status === 'paid' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
                        {card.status === 'paid' ? '납부 완료' : '납부 예정'}
                      </span>
                    </div>
                    <div className="mt-1 text-slate-400">
                      {card.paymentDate ? `${card.paymentDate} 출금 예정` : '결제일 미지정'} · {linkedAccount ? `[${linkedAccount.bankName}] ${linkedAccount.accountName}` : '결제계좌 미지정'}
                    </div>
                    <div className="mt-1 text-[11px] text-indigo-300">
                      {card.source === 'confirmed'
                        ? '직접 저장한 월 결제액'
                        : card.hasStatementWindow
                          ? `${card.usageStartDate} ~ ${card.usageEndDate} 사용액 자동 계산`
                          : `${card.usageYearMonth} 사용액 자동 계산 (이용기간 미설정)`}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="font-extrabold text-indigo-200">{formatKRW(card.amount)}</span>
                    <button
                      type="button"
                      onClick={() => onUpdateCardSettlementStatus(card.cardId, card.status === 'paid' ? 'scheduled' : 'paid')}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-colors ${card.status === 'paid' ? 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'}`}
                    >
                      {card.status === 'paid' ? '미납부로 되돌리기' : '납부 완료'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {cardSettlementSummary.unlinkedAmount > 0 && (
          <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-xs text-amber-200">
            결제계좌가 지정되지 않은 카드대금 {formatKRW(cardSettlementSummary.unlinkedAmount)}은 계좌별 확보액에 포함할 수 없습니다. 카드 설정에서 결제계좌를 연결해 주세요.
          </p>
        )}
        {duplicateManualCardSettlementCount > 0 && (
          <p className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-2.5 text-xs text-sky-200">
            동일 카드와 결제계좌로 등록된 기존 수동 카드대금 {duplicateManualCardSettlementCount}건은 자동 생성 항목으로 대체되어 고정지출 합계에서 제외했습니다.
          </p>
        )}

        {cardSettlementReviewItems.length > 0 && (
          <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>카드대금이 두 번 계산되고 있을 수 있습니다</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-300">
              아래 항목은 신용카드 결제계좌에서 나가는 고정지출로 등록돼 있고, 금액도 자동 생성된 카드대금과 비슷합니다.
              카드대금이 맞다면 자동 항목으로 대체해 중복을 없애고, 별개 지출이라면 그대로 두세요.
            </p>
            <ul className="space-y-2">
              {cardSettlementReviewItems.map(item => (
                <li key={item.templateId} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
                  <div className="text-xs font-bold text-slate-100">{item.templateName}</div>
                  <div className="mt-0.5 text-xs text-slate-400">{item.cardName} 카드대금과 중복 의심</div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onResolveCardSettlementReview(item.templateId, item.cardId)}
                      className="min-h-9 flex-1 rounded-lg bg-amber-500 text-xs font-extrabold text-slate-950 transition-colors hover:bg-amber-600"
                    >
                      카드대금이 맞습니다
                    </button>
                    <button
                      type="button"
                      onClick={() => onResolveCardSettlementReview(item.templateId, null)}
                      className="min-h-9 flex-1 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
                    >
                      별개 지출입니다
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Why the settings screen counts more items than this list does. */}
      {hiddenExpenseItems.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60">
          <button
            type="button"
            onClick={() => setShowHiddenItems(value => !value)}
            aria-expanded={showHiddenItems}
            className="flex w-full items-center justify-between gap-3 p-4 text-left"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-200">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
                이번 주기 목록에 없는 고정지출 {hiddenExpenseItems.length}건
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-400">
                설정에 등록한 항목 수와 이 목록의 건수가 다르면 아래에서 이유를 확인하세요.
              </span>
            </span>
            {showHiddenItems
              ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
              : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
          </button>

          {showHiddenItems && (
            <ul className="space-y-2 border-t border-slate-800 p-4">
              {hiddenExpenseItems.map(item => (
                <li key={item.templateId} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-slate-100">{item.name}</span>
                    <span className="shrink-0 text-slate-300">{formatKRW(item.amount)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-slate-400">
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-bold text-amber-200">
                      {HIDDEN_REASON_LABELS[item.reason]}
                    </span>
                    <span>매월 {item.dayOfMonth}일</span>
                    {item.reason === 'not_started' && <span>· 시작일 {item.startDate}</span>}
                    {item.otherCycleDate && <span>· 가까운 회차 {item.otherCycleDate}</span>}
                    {item.reason === 'not_generated' && <span>· 위의 새로 불러오기를 눌러 주세요</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setFilterStatus('pending')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterStatus === 'pending'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            미처리 대기 ({recurringOccurrences.filter((o) => o.status !== 'posted' && o.status !== 'skipped').length + pendingCardSettlementCount})
          </button>

          <button
            onClick={() => setFilterStatus('income')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterStatus === 'income'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            고정 수입만 ({incomeOccurrences.length})
          </button>

          <button
            onClick={() => setFilterStatus('expense')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterStatus === 'expense'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            고정 지출만 ({expenseOccurrences.length + cardSettlementItems.length})
          </button>

          <button
            onClick={() => setFilterStatus('posted')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterStatus === 'posted'
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            처리 완료 ({recurringOccurrences.filter((o) => o.status === 'posted').length + paidCardSettlementCount})
          </button>

          <button
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterStatus === 'all'
                ? 'bg-slate-800 text-slate-200 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            전체 보기 ({recurringOccurrences.length + cardSettlementItems.length})
          </button>
        </div>
      </div>

      {/* List of Recurring Items */}
      {filteredOccurrences.length === 0 && cardSettlementItems.length === 0 ? (
        <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
            <Receipt className="w-6 h-6" />
          </div>
          <p className="text-sm text-slate-300 font-medium">해당 조건의 정기 항목이 없습니다.</p>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            관리 메뉴의 '정기 항목 템플릿'에서 월급, 부수입, 관리비 등을 등록해보세요. 카드대금은 카드별 지출에서 자동 계산됩니다.
          </p>
        </div>
      ) : filteredOccurrences.length > 0 ? (
        <div className="space-y-3">
          {filteredOccurrences.map((occ) => {
            const tmpl = occ.tmpl;
            const cat = tmpl ? categoryMap.get(tmpl.categoryId) : undefined;
            const isPosted = occ.status === 'posted';
            const isIncome = occ.type === 'income';

            // Determine Account or Card details
            const cardObj = occ.cardId ? cardMap.get(occ.cardId) : (tmpl?.cardId ? cardMap.get(tmpl.cardId) : undefined);
            const accountObj = occ.accountId ? accountMap.get(occ.accountId) : (tmpl?.accountId ? accountMap.get(tmpl.accountId) : undefined);
            const linkedAccountOfCard = cardObj?.linkedAccountId ? accountMap.get(cardObj.linkedAccountId) : undefined;

            return (
              <div
                key={occ.id}
                className={`bg-slate-900 border rounded-2xl p-4 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isPosted
                    ? 'border-emerald-500/30 bg-emerald-950/10'
                    : isIncome
                    ? 'border-emerald-500/20 bg-emerald-950/5 hover:border-emerald-500/40'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Left side: Item Details */}
                <div className="flex items-start gap-3">
                  <div
                    className="w-11 h-11 rounded-2xl flex items-center justify-center text-lg font-bold shrink-0 shadow-inner"
                    style={{
                      backgroundColor: isIncome ? '#10B98120' : ((cat?.color || '#e11d48') + '20'),
                      color: isIncome ? '#10B981' : (cat?.color || '#e11d48'),
                      border: `1px solid ${isIncome ? '#10B98140' : ((cat?.color || '#e11d48') + '40')}`,
                    }}
                  >
                    {isIncome
                      ? <TrendingUp className="w-5 h-5" aria-hidden />
                      : <CategoryIcon name={cat?.icon} fallback={<CreditCard className="w-5 h-5" aria-hidden />} />}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-base text-white">{tmpl?.name || '삭제된 정기 항목'}</span>
                      {isIncome ? (
                        <span className="text-xs font-bold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-md border border-emerald-500/30 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" /> 고정 수입
                        </span>
                      ) : (
                        <span className="text-xs font-bold bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded-md border border-rose-500/30 flex items-center gap-1">
                          <TrendingDown className="w-3 h-3" /> 고정 지출
                        </span>
                      )}
                      {cat && (
                        <span className="text-xs font-semibold bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md border border-slate-700">
                          {cat.name}
                        </span>
                      )}
                      {tmpl?.allowAmountChange && (
                        <span className="text-xs font-semibold bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-md border border-amber-500/30">
                          매월 금액 변동
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
                      <span className="flex items-center gap-1 text-slate-300">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {isIncome ? '입금 예정일:' : '납부 예정일:'} {occ.scheduledDate}
                      </span>

                      {tmpl?.counterparty && (
                        <span className="text-slate-400">· {tmpl.counterparty}</span>
                      )}
                    </div>

                    {/* Payment Account / Card details */}
                    <div className="text-xs pt-1 flex items-center gap-2 text-slate-400">
                      {isIncome ? (
                        accountObj ? (
                          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-emerald-300">
                            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                            <span>입금계좌: <strong>[{accountObj.bankName}] {accountObj.accountName}</strong></span>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs italic">입금 계좌 미지정</span>
                        )
                      ) : cardObj ? (
                        <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-indigo-300">
                          <CreditCard className="w-3.5 h-3.5 text-indigo-400" />
                          <span>결제카드: <strong>{cardObj.cardName}</strong> ({cardObj.cardCompany})</span>
                          {linkedAccountOfCard && (
                            <span className="text-slate-400 text-xs border-l border-slate-800 pl-1.5">
                              출금계좌: {linkedAccountOfCard.bankName}
                            </span>
                          )}
                        </div>
                      ) : accountObj ? (
                        <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-rose-300">
                          <Wallet className="w-3.5 h-3.5 text-rose-400" />
                          <span>출금계좌: <strong>[{accountObj.bankName}] {accountObj.accountName}</strong></span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs italic">결제/출금 정보 미지정</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right side: Amount & Action button */}
                <div className="flex items-center justify-between sm:justify-end gap-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/80">
                  <div className="text-right">
                    <span className="text-xs text-slate-400 block">
                      {isIncome
                        ? (isPosted ? '최종 입금 금액' : '예상 입금 금액')
                        : (isPosted ? '최종 납부 금액' : '예상 납부 금액')}
                    </span>
                    <span
                      className={`text-lg font-bold ${
                        isIncome ? 'text-emerald-400' : isPosted ? 'text-emerald-400' : 'text-white'
                      }`}
                    >
                      {isIncome ? '+' : ''}{formatKRW(occ.actualAmount ?? occ.expectedAmount)}
                    </span>
                  </div>

                  <div>
                    {isPosted ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 bg-emerald-500/20 text-emerald-300 text-xs font-bold px-3 py-1.5 rounded-xl border border-emerald-500/30">
                          <Check className="w-4 h-4 text-emerald-400" />
                          {isIncome ? '입금 완료' : '납부 완료'}
                        </span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleOpenPaymentModal(occ)}
                        className={`text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-md transition-all active:scale-95 flex items-center gap-1.5 shrink-0 ${
                          isIncome
                            ? 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600'
                            : 'bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600'
                        }`}
                      >
                        {isIncome ? <TrendingUp className="w-4 h-4" /> : <Receipt className="w-4 h-4" />}
                        {isIncome ? '금액 확인 및 입금' : '금액 입력 및 납부'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* CONFIRM PAYMENT / INCOME MODAL */}
      <Modal
        isOpen={Boolean(selectedOcc)}
        onClose={() => setSelectedOcc(null)}
        labelledById="occurrence-modal-title"
        panelClassName="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 text-slate-100 shadow-2xl"
      >
        {selectedOcc && (() => {
              const tmpl = templateMap.get(selectedOcc.templateId);
              const isIncome = (selectedOcc.typeSnapshot ?? tmpl?.type) === 'income';

              return (
                <>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h3 id="occurrence-modal-title" className="font-bold text-base text-white flex items-center gap-2">
                        {isIncome ? (
                          <TrendingUp className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <Receipt className="w-5 h-5 text-rose-400" />
                        )}
                        {isIncome ? '정기 고정 수입 입금 확인' : '정기 지출 납부 확인'}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {isIncome
                          ? '실제 입금된 금액과 입금 계좌를 확인 후 수입 내역으로 처리합니다.'
                          : '실제 이달 청구된 금액과 결제/출금 계좌를 확인 후 납부 처리합니다.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedOcc(null)}
                      aria-label="확인 창 닫기"
                      className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <form onSubmit={handleConfirmPayment} className="space-y-4 text-xs" noValidate>
                    {/* Item Summary Banner */}
                    <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                      <div>
                        <span className="text-slate-400 text-xs">항목명</span>
                        <p className="font-bold text-sm text-white">
                          {tmpl?.name || '삭제된 정기 항목'}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-400 text-xs">{isIncome ? '입금 예정일' : '납부 예정일'}</span>
                        <p className="font-semibold text-xs text-slate-300">{selectedOcc.scheduledDate}</p>
                      </div>
                    </div>

                    {/* Amount Input */}
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">
                        {isIncome ? '이번 달 실제 입금 금액 (KRW)' : '이번 달 실제 납부 금액 (KRW)'}{' '}
                        <span className={isIncome ? 'text-emerald-400' : 'text-rose-400'}>*</span>
                      </label>
                      <AmountInput
                        id="occurrence-amount"
                        value={paymentAmount}
                        onChange={next => {
                          setPaymentError(null);
                          setPaymentAmount(next);
                        }}
                        placeholder="예: 3,500,000"
                        showQuickAdd
                        invalid={Boolean(paymentError)}
                        describedById={paymentError ? 'occurrence-amount-error' : undefined}
                        className="text-base"
                      />
                      {paymentError && (
                        <p id="occurrence-amount-error" role="alert" className="mt-1.5 text-xs font-semibold text-rose-300">
                          {paymentError}
                        </p>
                      )}
                      <p className="text-xs text-slate-400 mt-1">
                        {isIncome
                          ? '실제 수령한 급여/수입 금액을 확인하여 입력해주세요.'
                          : '가스비, 관리비 등 이번 달에 변동된 고정지출 금액을 입력해 주세요.'}
                      </p>
                    </div>

                    {/* Method Selector */}
                    <div>
                      <label className="block font-medium text-slate-300 mb-1.5">
                        {isIncome ? '입금 계좌 선택' : '결제 / 출금 수단 선택'}
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setPaymentMethodType('account')}
                          className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border font-semibold text-xs transition-all ${
                            paymentMethodType === 'account'
                              ? isIncome
                                ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300 shadow-md'
                                : 'bg-rose-600/30 border-rose-500 text-rose-300 shadow-md'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <Wallet className="w-4 h-4" />
                          은행 계좌
                        </button>

                        {!isIncome && (
                          <button
                            type="button"
                            onClick={() => setPaymentMethodType('card')}
                            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border font-semibold text-xs transition-all ${
                              paymentMethodType === 'card'
                                ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300 shadow-md'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <CreditCard className="w-4 h-4" />
                            카드 결제
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Account Dropdown Option */}
                    {paymentMethodType === 'account' && (
                      <div className="space-y-2 bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                        <label className="block font-medium text-slate-300">
                          {isIncome ? '입금받은 계좌 선택' : '출금 계좌 선택'}
                        </label>
                        <select
                          value={selectedAccountId}
                          onChange={(e) => setSelectedAccountId(e.target.value)}
                          className={`w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none ${
                            isIncome ? 'focus:border-emerald-500' : 'focus:border-rose-500'
                          }`}
                        >
                          <option value="">-- 계좌 선택 안함 --</option>
                          {bankAccounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              [{acc.bankName}] {acc.accountName} ({acc.accountNumber})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Card Dropdown Option */}
                    {!isIncome && paymentMethodType === 'card' && (
                      <div className="space-y-2 bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                        <label className="block font-medium text-slate-300">결제 카드 선택</label>
                        <select
                          value={selectedCardId}
                          onChange={(e) => setSelectedCardId(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                        >
                          <option value="">-- 카드 선택 안함 --</option>
                          {paymentCards.map((card) => {
                            const linkedAcc = bankAccounts.find((a) => a.id === card.linkedAccountId);
                            return (
                              <option key={card.id} value={card.id}>
                                {card.cardName} ({card.cardCompany})
                                {linkedAcc ? ` [출금: ${linkedAcc.bankName}]` : ''}
                              </option>
                            );
                          })}
                        </select>

                        {selectedCardId && cardMap.get(selectedCardId) && (
                          <div className="text-xs text-indigo-300 bg-indigo-950/30 p-2 rounded-lg border border-indigo-500/20 flex items-center gap-1.5">
                            <ArrowRightLeft className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            <span>
                              카드 연결 출금 계좌:{' '}
                              {cardMap.get(selectedCardId)?.linkedAccountId &&
                              accountMap.get(cardMap.get(selectedCardId)!.linkedAccountId!)
                                ? `${accountMap.get(cardMap.get(selectedCardId)!.linkedAccountId!)?.bankName} (${
                                    accountMap.get(cardMap.get(selectedCardId)!.linkedAccountId!)?.accountNumber
                                  })`
                                : '출금계좌 미지정'}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs leading-relaxed text-slate-300">
                      이 금액과 결제수단은 선택한 월에만 저장됩니다. 다음 달 일반 고정지출은 이 금액을 그대로 이어받으며 다시 수정할 수 있습니다.
                      카드 결제 항목은 선택한 카드의 결제예정액에도 포함됩니다.
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => setSelectedOcc(null)}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl transition-colors font-medium"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveMonthlyPlan}
                        className="rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-4 py-2 font-bold text-indigo-200 transition-colors hover:bg-indigo-500/25"
                      >
                        이번 달 금액만 저장
                      </button>
                      <button
                        type="submit"
                        className={`text-white font-bold px-4 py-2 rounded-xl shadow-lg transition-colors flex items-center gap-1.5 ${
                          isIncome
                            ? 'bg-emerald-600 hover:bg-emerald-500'
                            : 'bg-rose-600 hover:bg-rose-700'
                        }`}
                      >
                        <Check className="w-4 h-4" />
                        {isIncome ? '수입 입금 확정' : '납부 완료 처리'}
                      </button>
                    </div>
                  </form>
                </>
              );
        })()}
      </Modal>
    </div>
  );
};
