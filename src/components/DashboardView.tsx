import React from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Calendar,
  Zap,
  ArrowRight,
  Clock,
  CheckCircle2,
  Lock,
  Sparkles,
  CreditCard,
  HelpCircle,
} from 'lucide-react';
import { MonthSummary, formatKRW } from '../utils/calculations';
import { RecurringOccurrence, Category, BankAccount } from '../types';
import { CardPaymentSummary, MonthlyCardSettlementSummary } from '../utils/cardPayments';

interface DashboardViewProps {
  summary: MonthSummary;
  upcomingOccurrences: RecurringOccurrence[];
  categories: Category[];
  categoryBreakdown: { categoryId: string; categoryName: string; amount: number; percent: number; color: string }[];
  cardPaymentSummary: CardPaymentSummary;
  cardSettlementSummary: MonthlyCardSettlementSummary;
  bankAccounts: BankAccount[];
  onOpenAddModal: () => void;
  onNavigateTab: (tab: 'history' | 'analytics' | 'management' | 'accounts', subTab?: string) => void;
  onConfirmOccurrence: (occId: string) => void;
  /** Only shown until the user finishes or skips setup. */
  showSetupPrompt: boolean;
  onStartSetup: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  summary,
  upcomingOccurrences,
  categories,
  categoryBreakdown,
  cardPaymentSummary,
  cardSettlementSummary,
  bankAccounts,
  onOpenAddModal,
  onNavigateTab,
  onConfirmOccurrence,
  showSetupPrompt,
  onStartSetup,
}) => {
  const getAlertBadgeProps = () => {
    switch (summary.alertLevel) {
      case 'safe':
        return {
          bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
          text: '안정 (0~69%)',
          desc: '안전한 용돈 사용 속도를 유지하고 있습니다.',
          icon: ShieldCheck,
          barBg: 'bg-emerald-500',
        };
      case 'caution':
        return {
          bg: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
          text: '주의 (70~84%)',
          desc: '월 용돈의 70%를 넘었습니다. 남은 용돈을 확인하세요.',
          icon: AlertTriangle,
          barBg: 'bg-amber-500',
        };
      case 'warning':
        return {
          bg: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
          text: '위험 (85~99%)',
          desc: '용돈이 얼마 남지 않았습니다. 선택 지출을 줄여주세요.',
          icon: ShieldAlert,
          barBg: 'bg-orange-500',
        };
      case 'danger':
      default:
        return {
          bg: 'bg-rose-500/15 text-rose-400 border-rose-500/40',
          text: '한도 초과 (100%+)',
          desc: '월 용돈을 초과했습니다. 추가 지출을 멈추고 기록만 유지하세요.',
          icon: ShieldAlert,
          barBg: 'bg-rose-500',
        };
    }
  };

  const badgeProps = getAlertBadgeProps();
  const AlertIcon = badgeProps.icon;

  const topRisky = categoryBreakdown.slice(0, 3);
  const linkedAccountIds = new Set(
    cardPaymentSummary.creditCards
      .map(card => card.linkedAccountId)
      .filter((accountId): accountId is string => Boolean(accountId) && bankAccounts.some(account => account.id === accountId)),
  );
  const linkedAccounts = bankAccounts.filter(account => linkedAccountIds.has(account.id));
  const linkedAccountBalance = linkedAccounts.reduce((sum, account) => sum + Math.round(account.balance || 0), 0);
  const linkedCardPaymentTotal = cardPaymentSummary.creditCards
    .filter(card => card.linkedAccountId && linkedAccountIds.has(card.linkedAccountId))
    .reduce((sum, card) => sum + card.totalAmount, 0);
  const projectedLinkedAccountBalance = linkedAccountBalance - linkedCardPaymentTotal;
  const unlinkedCreditPayment = cardPaymentSummary.estimatedNextPaymentTotal - linkedCardPaymentTotal;

  return (
    <div className="space-y-6 pb-24">
      {/* 1. Core Allowance Control Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
        {/* Subtle Ambient Background Gradient */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header & Alert Level Badge */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-slate-800/80 text-slate-300 border-slate-700">
              {summary.yearMonth} 기준
            </span>
            <span className="text-xs text-slate-400">남은 날짜 {summary.daysRemaining}일</span>
          </div>

          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${badgeProps.bg}`}>
            <AlertIcon className="w-3.5 h-3.5" />
            <span>{badgeProps.text}</span>
          </div>
        </div>

        {/* Primary Focus: Today's Safe Allowance */}
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="flex items-center gap-1.5 font-medium text-slate-300">
              <Zap className="w-4 h-4 text-amber-400" />
              오늘 안전 용돈
            </span>
            <span className="text-xs text-slate-400">(남은 용돈 / 남은 {summary.daysRemaining}일)</span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-3xl font-extrabold text-white tracking-tight">
              {formatKRW(summary.dailySafeAllowance)}
            </div>
            <button
              onClick={onOpenAddModal}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1 shadow-md shadow-rose-950/30"
            >
              + 지출 기록
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2 border-t border-slate-800/60 pt-2 flex items-center justify-between">
            <span>입금된 수입에서 이번 급여 주기의 고정비를 먼저 확보한 뒤 계산합니다</span>
            <span className="font-semibold text-rose-300">남은 용돈: {formatKRW(summary.remainingAllowance)}</span>
          </p>
        </div>

        {/* Budget Usage Progress Bar */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">이번 달 용돈 사용</span>
            <div className="text-slate-200 font-semibold">
              <span className="text-white font-bold">{formatKRW(summary.confirmedVariableExpenses)}</span>
              <span className="text-slate-400"> / 사용 가능 {formatKRW(summary.spendableLimit)}</span>
              <span className="ml-2 font-bold text-rose-400">({summary.budgetUsagePercent}%)</span>
            </div>
          </div>

          <div
            role="progressbar"
            aria-valuenow={summary.budgetUsagePercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`이번 달 용돈 사용률 ${summary.budgetUsagePercent}%`}
            className="w-full h-3 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${badgeProps.barBg}`}
              style={{ width: `${Math.min(100, summary.budgetUsagePercent)}%` }}
            />
          </div>

          <p className="text-xs text-slate-400 flex items-center justify-between">
            <span>남은 용돈: {formatKRW(summary.remainingAllowance)}</span>
            <span>{badgeProps.desc}</span>
          </p>
        </div>

        {/* Income, fixed commitments, and planned savings stay separate from allowance. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-800 text-xs">
          <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800/60">
            <div className="text-slate-400 mb-1 flex items-center justify-between">
              <span>이번 달 수입</span>
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="font-bold text-sm text-emerald-400">{formatKRW(summary.totalIncome)}</div>
            <div className="text-xs text-slate-400 mt-0.5">
              입금 {formatKRW(summary.confirmedIncome)} | 정기 등록 {formatKRW(summary.scheduledIncome)}
            </div>
          </div>

          <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800/60">
            <div className="text-slate-400 mb-1 flex items-center justify-between">
              <span>급여일에 먼저 확보할 고정지출</span>
              <Lock className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="font-bold text-sm text-indigo-300">
              {formatKRW(summary.totalExpectedFixedExpenses)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              납부 {formatKRW(summary.confirmedFixedExpenses)} | 미납부·예약 {formatKRW(summary.remainingScheduledExpenses)}
            </div>
          </div>

          <div className={`rounded-xl p-3 border ${
            summary.plannedSavings >= 0
              ? 'bg-emerald-500/5 border-emerald-500/20'
              : 'bg-rose-500/5 border-rose-500/20'
          }`}>
            <div className="text-slate-400 mb-1 flex items-center justify-between">
              <span>{summary.plannedSavings >= 0 ? '저축 예정액' : '용돈 한도 초과 설정'}</span>
              <Sparkles className={`w-3.5 h-3.5 ${summary.plannedSavings >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} />
            </div>
            <div className={`font-bold text-sm ${summary.plannedSavings >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {formatKRW(summary.plannedSavings >= 0 ? summary.plannedSavings : summary.allowanceOverCapacity)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              수입 - 고정비 - 용돈 한도
            </div>
          </div>
        </div>
      </div>

      {/* 2. Credit card usage and next settlement estimate */}
      {(cardPaymentSummary.creditCards.length > 0 || cardPaymentSummary.totalCardUsage > 0) && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-md">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center">
                <CreditCard className="w-4 h-4 text-indigo-300" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100">카드 사용과 다음 결제</h3>
                <p className="text-xs text-slate-400">구매 시 소비 반영 · 결제일에는 계좌 정산</p>
              </div>
            </div>
            <button
              onClick={() => onNavigateTab('accounts')}
              className="text-xs font-semibold text-indigo-300 hover:text-indigo-200"
            >
              카드 설정
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
              <div className="text-xs text-slate-400">이번 달 계좌 고정 출금</div>
              <div className="mt-1 text-base font-bold text-rose-300">
                {formatKRW(cardSettlementSummary.linkedAccountTotal)}
              </div>
              <div className="mt-0.5 text-xs text-slate-400">신용카드 결제계좌 자동 반영</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-xs text-slate-400">이번 달 전체 카드 사용</div>
              <div className="mt-1 text-base font-bold text-slate-100">{formatKRW(cardPaymentSummary.totalCardUsage)}</div>
              <div className="mt-0.5 text-xs text-slate-400">
                체크카드 {formatKRW(cardPaymentSummary.debitCardUsage)} 포함
              </div>
            </div>
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
              <div className="text-xs text-slate-400">다음 달 신용카드 결제 추정</div>
              <div className="mt-1 text-base font-bold text-indigo-300">
                {formatKRW(cardPaymentSummary.estimatedNextPaymentTotal)}
              </div>
              <div className="mt-0.5 text-xs text-slate-400">이번 달 사용분 기준</div>
            </div>
          </div>

          {cardPaymentSummary.creditCards.some(card => card.totalAmount > 0) ? (
            <div className="space-y-2">
              {cardPaymentSummary.creditCards.filter(card => card.totalAmount > 0).slice(0, 4).map(card => {
                const linkedAccount = bankAccounts.find(account => account.id === card.linkedAccountId);
                return (
                  <div key={card.cardId} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-bold text-slate-200">{card.cardName}</div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          {card.estimatedPaymentDate ? `${card.estimatedPaymentDate} 결제 추정` : '결제일 설정 필요'}
                          {linkedAccount ? ` · ${linkedAccount.accountName} 출금` : ' · 출금 계좌 미지정'}
                        </div>
                      </div>
                      <div className="font-bold text-indigo-300">{formatKRW(card.totalAmount)}</div>
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t border-slate-800/70 pt-2 text-xs text-slate-400">
                      <span>용돈 사용 {formatKRW(card.allowanceAmount)}</span>
                      <span>카드 결제 고정비 {formatKRW(card.fixedAmount)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-center text-xs text-slate-400">
              <p>이번 기간에 등록된 신용카드 사용이 없습니다.</p>
              <button
                onClick={() => onNavigateTab('accounts')}
                className="min-h-9 rounded-lg border border-slate-700 bg-slate-900 px-3 font-semibold text-slate-200 transition-colors hover:bg-slate-800"
              >
                카드 등록하기
              </button>
            </div>
          )}

          {linkedAccounts.length > 0 && (
            <div className={`rounded-xl border p-3 text-xs ${
              projectedLinkedAccountBalance >= 0
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-rose-500/30 bg-rose-500/5'
            }`}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">카드대금 차감 후 연결계좌 예상잔액</span>
                <span className={`font-bold ${projectedLinkedAccountBalance >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {formatKRW(projectedLinkedAccountBalance)}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                입력된 수동잔액 {formatKRW(linkedAccountBalance)} - 결제 추정 {formatKRW(linkedCardPaymentTotal)}
              </div>
            </div>
          )}

          {(cardPaymentSummary.unassignedCardUsage > 0 || unlinkedCreditPayment > 0) && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-2.5 text-xs leading-relaxed text-amber-200">
              {cardPaymentSummary.unassignedCardUsage > 0 && (
                <span>카드 미지정 거래 {formatKRW(cardPaymentSummary.unassignedCardUsage)}은 신용·체크 구분과 결제일을 확인할 수 없습니다. </span>
              )}
              {unlinkedCreditPayment > 0 && (
                <span>출금 계좌가 연결되지 않은 신용카드 결제 추정액은 {formatKRW(unlinkedCreditPayment)}입니다.</span>
              )}
            </div>
          )}

          {/* Long explanation folds away: it matters once, not on every visit. */}
          <details className="group rounded-xl border border-slate-800 bg-slate-950/40">
            <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-300 marker:content-['']">
              <HelpCircle className="h-3.5 w-3.5 text-slate-400" />
              <span>이 금액은 어떻게 계산하나요?</span>
            </summary>
            <p className="border-t border-slate-800 px-3 py-2 text-xs leading-relaxed text-slate-400">
              카드 이용기간 마감일 정보가 없어 이번 달 사용분이 다음 달 결제된다고 가정한 추정치입니다.
              월별 카드대금은 연결 계좌의 고정 출금에는 반영하지만, 구매 금액이 이미 지출에 포함되어 있어 지출 총액에는 다시 합산하지 않습니다.
            </p>
          </details>
        </div>
      )}

      {/* 3. Month-End Forecast Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-md flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>현재 용돈 사용 속도 기준 월말 예상 저축</span>
          </div>
          <div className="text-xl font-bold text-slate-100">
            {summary.forecastSavings !== null
              ? formatKRW(summary.forecastSavings)
              : summary.plannedSavings >= 0
                ? `용돈 한도를 지키면 ${formatKRW(summary.plannedSavings)} 저축 예정`
                : `현재 설정이면 ${formatKRW(summary.allowanceOverCapacity)} 부족`}
          </div>
          {summary.forecastVariableSpend !== null && (
            <p className="text-xs text-slate-400 mt-0.5">
              용돈 한도 대비{' '}
              {summary.forecastVariableSpend > summary.allowanceLimit ? (
                <span className="text-rose-400 font-semibold">
                  +{formatKRW(summary.forecastVariableSpend - summary.allowanceLimit)} 초과 예상
                </span>
              ) : (
                <span className="text-emerald-400 font-semibold">
                  {formatKRW(summary.allowanceLimit - summary.forecastVariableSpend)} 남길 예상
                </span>
              )}
            </p>
          )}
        </div>

        <button
          onClick={() => onNavigateTab('analytics')}
          className="text-xs bg-slate-800 hover:bg-slate-700 text-rose-300 border border-slate-700 px-3 py-2 rounded-lg flex items-center gap-1 font-medium transition-colors"
        >
          <span>분석 리포트</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 3. Risky Categories Warning */}
      {topRisky.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>주의가 필요한 주요 용돈 지출</span>
            </h3>
            <button
              onClick={() => onNavigateTab('analytics')}
              className="text-xs text-slate-400 hover:text-rose-400 transition-colors"
            >
              전체 보기
            </button>
          </div>

          <div className="space-y-2.5">
            {topRisky.map(cat => (
              <div key={cat.categoryId} className="bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="font-semibold text-slate-200">{cat.categoryName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-400">{cat.percent}% 비중</span>
                  <span className="font-bold text-white">{formatKRW(cat.amount)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Upcoming Recurring Schedule Widget */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-200">이번 달 예정 정기 항목 타임라인</h3>
          </div>
          <button
            onClick={() => onNavigateTab('management', 'recurring')}
            className="text-xs text-rose-400 hover:text-rose-300 font-medium transition-colors flex items-center gap-1"
          >
            <span>정기 관리</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {upcomingOccurrences.length === 0 ? (
          <div className="space-y-2 rounded-lg border border-slate-800/60 bg-slate-950/40 py-6 text-center text-xs text-slate-400">
            <p>이 기간에 남은 정기 지출 및 수입 일정이 없습니다.</p>
            <button
              onClick={() => onNavigateTab('management', 'recurring')}
              className="min-h-9 rounded-lg border border-slate-700 bg-slate-900 px-3 font-semibold text-slate-200 transition-colors hover:bg-slate-800"
            >
              정기 항목 추가
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {upcomingOccurrences.slice(0, 3).map(occ => (
              <div
                key={occ.id}
                className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-200">{occ.scheduledDate}</span>
                    <span className="text-xs font-semibold bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700">
                      {occ.status === 'needs_confirmation' ? '확인 필요' : '예정'}
                    </span>
                  </div>
                  <div className="text-slate-400 mt-1">예상 금액: {formatKRW(occ.expectedAmount)}</div>
                </div>

                <button
                  onClick={() => onConfirmOccurrence(occ.id)}
                  className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-medium px-3 py-1.5 rounded-md transition-colors flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>거래 확정</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. First-run setup. Hidden once recurring items exist or setup is dismissed. */}
      {showSetupPrompt && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
              <Sparkles className="h-4 w-4" />
              <span>초기 설정이 아직 없습니다</span>
            </div>
            <p className="text-xs text-slate-300">
              월 수입, 고정비, 용돈 한도만 입력하면 오늘 안전 용돈이 바로 계산됩니다.
            </p>
          </div>

          <button
            onClick={onStartSetup}
            className="min-h-11 whitespace-nowrap rounded-lg bg-amber-500 px-3.5 text-xs font-bold text-slate-950 shadow-md shadow-amber-950/20 transition-colors hover:bg-amber-600"
          >
            설정 시작
          </button>
        </div>
      )}
    </div>
  );
};
