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
  Filter,
  Check,
  X,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import {
  BankAccount,
  Category,
  PaymentCard,
  PaymentMethodType,
  RecurringOccurrence,
  RecurringTemplate
} from '../types';
import { AccountingPeriod, formatKRW, formatPeriodRange } from '../utils/calculations';
import { Modal } from './ui/Modal';
import { AmountInput } from './ui/AmountInput';

interface RecurringPaymentViewProps {
  /** Period comes from the app-wide selector; this view no longer owns month state. */
  period: AccountingPeriod;
  recurringOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  categories: Category[];
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  onPostOccurrence: (
    occId: string,
    customAmount?: number,
    customPaymentMethodType?: PaymentMethodType,
    customAccountId?: string | null,
    customCardId?: string | null
  ) => void;
  onUpdateOccurrenceStatus: (occId: string, status: any) => void;
}

export const RecurringPaymentView: React.FC<RecurringPaymentViewProps> = ({
  period,
  recurringOccurrences,
  recurringTemplates,
  categories,
  bankAccounts,
  paymentCards,
  onPostOccurrence,
  onUpdateOccurrenceStatus,
}) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'posted' | 'expense' | 'income'>('pending');

  // Modal State for Confirming Payment / Income
  const [selectedOcc, setSelectedOcc] = useState<RecurringOccurrence | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethodType, setPaymentMethodType] = useState<PaymentMethodType>('account');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedCardId, setSelectedCardId] = useState<string>('');
  const [paymentError, setPaymentError] = useState<string | null>(null);

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

    const isIncome = tmpl?.type === 'income';
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

  // Map Occurrences with template type
  const occurrencesWithTemplates = recurringOccurrences.map((occ) => {
    const tmpl = templateMap.get(occ.templateId);
    const type = tmpl?.type || 'expense';
    return { ...occ, type, tmpl };
  });

  const incomeOccurrences = occurrencesWithTemplates.filter((o) => o.type === 'income');
  const expenseOccurrences = occurrencesWithTemplates.filter((o) => o.type === 'expense');

  const totalScheduledIncome = incomeOccurrences.reduce(
    (sum, o) => sum + (o.actualAmount ?? o.expectedAmount),
    0
  );
  const totalPostedIncome = incomeOccurrences
    .filter((o) => o.status === 'posted')
    .reduce((sum, o) => sum + (o.actualAmount ?? o.expectedAmount), 0);
  const pendingIncomeAmount = totalScheduledIncome - totalPostedIncome;

  const totalScheduledExpense = expenseOccurrences.reduce(
    (sum, o) => sum + (o.actualAmount ?? o.expectedAmount),
    0
  );
  const totalPostedExpense = expenseOccurrences
    .filter((o) => o.status === 'posted')
    .reduce((sum, o) => sum + (o.actualAmount ?? o.expectedAmount), 0);
  const pendingExpenseAmount = totalScheduledExpense - totalPostedExpense;

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
            급여 등 고정 수입 입금과 가스비, 관리비, 카드대금 등 고정 지출 납부를 한곳에서 확인하고 처리합니다.
          </p>
        </div>

        <div className="self-start rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs sm:self-auto">
          <span className="font-bold text-white">{period.yearMonth.replace('-', '년 ')}월</span>
          {periodRange && <span className="ml-1.5 text-slate-400">{periodRange}</span>}
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
              월 고정 지출 예정액
            </span>
            <span className="text-xs text-slate-400 font-medium">납부 완료: {formatKRW(totalPostedExpense)}</span>
          </div>
          <p className="text-xl font-extrabold text-white mt-1">{formatKRW(totalScheduledExpense)}</p>
          <p className="text-xs text-slate-400 mt-1">
            남은 납부 예정: <strong className="text-amber-300">{formatKRW(pendingExpenseAmount)}</strong>
          </p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold">
            <Clock className="w-4 h-4" />
            미처리 항목 건수
          </div>
          <p className="text-xl font-extrabold text-indigo-300 mt-1">
            {recurringOccurrences.filter((o) => o.status !== 'posted' && o.status !== 'skipped').length}건
          </p>
          <p className="text-xs text-slate-400 mt-1">
            수입 {incomeOccurrences.filter(o => o.status !== 'posted').length}건 / 지출 {expenseOccurrences.filter(o => o.status !== 'posted').length}건 대기 중
          </p>
        </div>
      </div>

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
            미처리 대기 ({recurringOccurrences.filter((o) => o.status !== 'posted' && o.status !== 'skipped').length})
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
            고정 지출만 ({expenseOccurrences.length})
          </button>

          <button
            onClick={() => setFilterStatus('posted')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterStatus === 'posted'
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            처리 완료 ({recurringOccurrences.filter((o) => o.status === 'posted').length})
          </button>

          <button
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterStatus === 'all'
                ? 'bg-slate-800 text-slate-200 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            전체 보기 ({recurringOccurrences.length})
          </button>
        </div>
      </div>

      {/* List of Recurring Items */}
      {filteredOccurrences.length === 0 ? (
        <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
            <Receipt className="w-6 h-6" />
          </div>
          <p className="text-sm text-slate-300 font-medium">해당 조건의 정기 항목이 없습니다.</p>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            관리 메뉴의 '정기 항목 템플릿'에서 월급, 부수입, 매월 발생하는 카드대금, 관리비 등을 등록해보세요.
          </p>
        </div>
      ) : (
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
                    {isIncome ? '💰' : (cat?.icon || '💳')}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-base text-white">{tmpl?.name || '정기 항목'}</span>
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
      )}

      {/* CONFIRM PAYMENT / INCOME MODAL */}
      <Modal
        isOpen={Boolean(selectedOcc)}
        onClose={() => setSelectedOcc(null)}
        labelledById="occurrence-modal-title"
        panelClassName="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 text-slate-100 shadow-2xl"
      >
        {selectedOcc && (() => {
              const tmpl = templateMap.get(selectedOcc.templateId);
              const isIncome = tmpl?.type === 'income';

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
                          {tmpl?.name || '정기 항목'}
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
                          : '가스비, 관리비, 카드 청구액 등 변경된 실제 지출 금액을 입력해 주세요.'}
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

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => setSelectedOcc(null)}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl transition-colors font-medium"
                      >
                        취소
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
