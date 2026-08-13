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
  ChevronDown,
} from 'lucide-react';
import { MonthSummary, formatKRW } from '../utils/calculations';
import { RecurringOccurrence, RecurringTemplate, Category, BankAccount, PaymentCard } from '../types';
import { CardPaymentSummary, MonthlyCardSettlementSummary } from '../utils/cardPayments';
import { getPendingRecurringTimeline } from '../utils/recurringTimeline';

interface DashboardViewProps {
  summary: MonthSummary;
  upcomingOccurrences: RecurringOccurrence[];
  recurringTemplates: RecurringTemplate[];
  categories: Category[];
  categoryBreakdown: { categoryId: string; categoryName: string; amount: number; percent: number; color: string }[];
  cardPaymentSummary: CardPaymentSummary;
  cardSettlementSummary: MonthlyCardSettlementSummary;
  bankAccounts: BankAccount[];
  paymentCards: PaymentCard[];
  onOpenAddModal: () => void;
  onNavigateTab: (tab: 'history' | 'analytics' | 'management' | 'accounts', subTab?: string) => void;
  onConfirmOccurrence: (occId: string) => void;
  /** Only shown until the user finishes or skips setup. */
  showSetupPrompt: boolean;
  onStartSetup: () => void;
  /** True once the cycle has started but its living budget is not locked yet. */
  showPaydayPrompt: boolean;
  onStartPayday: () => void;
  /** Accepts the drift in `summary.unplannedDelta` as the new plan. */
  onRefreshBaseline: () => void;
  onDismissBaselineChange: () => void;
  /** Hides the change notice until the numbers move again. */
  baselineChangeDismissed: boolean;
  /** Rendered above everything when the previous cycle has a plan to close out. */
  cycleClosingSlot?: React.ReactNode;
}

/**
 * An aggregate that opens to show what it is made of. Every figure on this
 * screen is derived from several others, and "why is it that number" is the
 * question the dashboard used to leave unanswered.
 */
const AmountBreakdown: React.FC<{
  label: string;
  amount: number;
  amountClassName: string;
  swatchClassName: string;
  rows: Array<{ label: string; value: number; hint?: string }>;
  emptyHint?: string;
}> = ({ label, amount, amountClassName, swatchClassName, rows, emptyHint }) => (
  <details className="group">
    <summary className="flex cursor-pointer list-none items-center justify-between py-0.5 marker:content-['']">
      <span className="flex items-center gap-1.5 text-slate-400">
        <span aria-hidden className={`h-2 w-2 rounded-sm ${swatchClassName}`} />
        {label}
        <ChevronDown className="h-3 w-3 text-slate-600 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </span>
      <span className={`font-semibold ${amountClassName}`}>{formatKRW(amount)}</span>
    </summary>
    <dl className="mt-1 space-y-1 border-l border-slate-800 pl-3 text-xs">
      {rows.length === 0 ? (
        <p className="text-slate-500">{emptyHint || '구성 항목이 없습니다.'}</p>
      ) : (
        rows.map(row => (
          <div key={row.label} className="flex items-start justify-between gap-2">
            <dt className="min-w-0 text-slate-400">
              <span className="block truncate">{row.label}</span>
              {row.hint && <span className="block text-slate-500">{row.hint}</span>}
            </dt>
            <dd className="shrink-0 text-slate-300">{formatKRW(row.value)}</dd>
          </div>
        ))
      )}
    </dl>
  </details>
);

export const DashboardView: React.FC<DashboardViewProps> = ({
  summary,
  upcomingOccurrences,
  recurringTemplates,
  categories,
  categoryBreakdown,
  cardPaymentSummary,
  cardSettlementSummary,
  bankAccounts,
  paymentCards,
  onOpenAddModal,
  onNavigateTab,
  onConfirmOccurrence,
  showSetupPrompt,
  onStartSetup,
  showPaydayPrompt,
  onStartPayday,
  onRefreshBaseline,
  onDismissBaselineChange,
  baselineChangeDismissed,
  cycleClosingSlot,
}) => {
  const getAlertBadgeProps = () => {
    switch (summary.alertLevel) {
      case 'safe':
        return {
          bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
          text: '안정 (0~69%)',
          desc: '안전한 생활비 사용 속도를 유지하고 있습니다.',
          icon: ShieldCheck,
          barBg: 'bg-emerald-500',
        };
      case 'caution':
        return {
          bg: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
          text: '주의 (70~84%)',
          desc: '이번 주기 생활비의 70%를 넘었습니다. 남은 생활비를 확인하세요.',
          icon: AlertTriangle,
          barBg: 'bg-amber-500',
        };
      case 'warning':
        return {
          bg: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
          text: '위험 (85~99%)',
          desc: '생활비가 얼마 남지 않았습니다. 선택 지출을 줄여주세요.',
          icon: ShieldAlert,
          barBg: 'bg-orange-500',
        };
      case 'danger':
      default:
        return {
          bg: 'bg-rose-500/15 text-rose-400 border-rose-500/40',
          text: '한도 초과 (100%+)',
          desc: '이번 주기 생활비를 초과했습니다. 추가 지출을 멈추고 기록만 유지하세요.',
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
  const pendingRecurringTimeline = getPendingRecurringTimeline(upcomingOccurrences);
  // Cards billed this cycle can charge different months, so only label the
  // usage window when every bill agrees on one.
  const cardBillUsageMonths = [...new Set(cardSettlementSummary.cards.map(card => card.usageYearMonth))];
  const cardBillUsageLabel = cardBillUsageMonths.length === 1 ? cardBillUsageMonths[0] : '';
  // Envelope order matches the breakdown rows below it.
  const envelopeSegments = [
    { label: '계좌 고정 이체', amount: summary.accountFixedOutflow, className: 'bg-slate-500' },
    { label: '카드대금', amount: summary.cardSettlementOutflow, className: 'bg-indigo-500' },
    { label: '저축', amount: summary.savingsReserve, className: 'bg-emerald-500' },
    { label: '생활비', amount: summary.livingBudget, className: 'bg-rose-500' },
  ].filter(segment => segment.amount > 0);
  // Any card without a confirmed amount makes the total a projection, and a
  // projection should not look like a settled figure.
  const cardBillIsEstimated = cardSettlementSummary.cards
    .some(card => card.amount > 0 && card.source === 'estimated');

  const describeRecurringPaymentMethod = (occurrence: RecurringOccurrence, template?: RecurringTemplate) => {
    const paymentMethodType = occurrence.paymentMethodType || template?.paymentMethodType;
    const accountId = occurrence.accountId || template?.accountId;
    const cardId = occurrence.cardId || template?.cardId;

    if (paymentMethodType === 'card') {
      const card = paymentCards.find(candidate => candidate.id === cardId);
      return card ? `카드 · ${card.cardName}` : '카드 결제';
    }
    if (paymentMethodType === 'account') {
      const account = bankAccounts.find(candidate => candidate.id === accountId);
      return account ? `계좌 · ${account.accountName}` : '계좌 이체';
    }
    return '직접 결제 / 기타';
  };

  const showBaselineChange = summary.isBaselineLocked
    && summary.unplannedDelta !== 0
    && !baselineChangeDismissed;

  return (
    <div className="space-y-6 pb-24">
      {cycleClosingSlot}

      {/* 0. Payday routine. The cycle has started but its budget is not committed. */}
      {showPaydayPrompt && (
        <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-slate-900 to-slate-900 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                <Sparkles className="h-4 w-4" />
                <span>이번 주기 생활비를 아직 확정하지 않았습니다</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-300">
                급여 입금 확인 → 고정지출 이체 → 카드대금 확인까지 한 번에 마치고,
                다음 급여일까지 쓸 금액을 정해 두세요.
              </p>
            </div>
            <button
              onClick={onStartPayday}
              className="min-h-11 shrink-0 whitespace-nowrap rounded-lg bg-emerald-500 px-3.5 text-xs font-extrabold text-slate-950 shadow-md shadow-emerald-950/20 transition-colors hover:bg-emerald-600"
            >
              확정 시작
            </button>
          </div>
        </div>
      )}

      {/* 0b. The locked plan no longer matches reality. Ask, never silently adjust. */}
      {showBaselineChange && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            <span>이번 주기 계획이 바뀔 수 있습니다</span>
          </div>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">확정한 생활비</dt>
              <dd className="font-semibold text-slate-200">{formatKRW(summary.livingBudget)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">지금 기준으로 다시 계산하면</dt>
              <dd className="font-semibold text-slate-200">{formatKRW(summary.recalculatedLivingBudget)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-amber-500/20 pt-1.5">
              <dt className="font-semibold text-slate-300">차이</dt>
              <dd className={`font-extrabold ${summary.unplannedDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {summary.unplannedDelta >= 0 ? '+' : '−'}{formatKRW(Math.abs(summary.unplannedDelta))}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            고정비·카드대금·급여 중 무언가가 확정 이후에 바뀌었습니다. 그대로 두면 남은 생활비는 확정 금액을 유지합니다.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={onRefreshBaseline}
              className="min-h-10 flex-1 rounded-lg bg-amber-500 text-xs font-extrabold text-slate-950 transition-colors hover:bg-amber-600"
            >
              계획 갱신
            </button>
            <button
              onClick={onDismissBaselineChange}
              className="min-h-10 flex-1 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
            >
              그대로 두기
            </button>
          </div>
        </div>
      )}

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
            {summary.isProjected && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-300">
                급여 입금 예정 기준
              </span>
            )}
            {summary.isBaselineLocked && (
              <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-300">
                <Lock className="h-3 w-3" />
                생활비 확정됨
              </span>
            )}
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
              오늘 쓸 수 있는 돈
            </span>
            <span className="text-xs text-slate-400">(남은 생활비 / 남은 {summary.daysRemaining}일)</span>
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
            <span>급여에서 계좌 고정 이체와 카드대금을 먼저 확보한 뒤 계산합니다</span>
            <span className="font-semibold text-rose-300">남은 생활비: {formatKRW(summary.remainingAllowance)}</span>
          </p>
        </div>

        {/* Budget Usage Progress Bar */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">이번 주기 생활비 사용</span>
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
            aria-label={`이번 주기 생활비 사용률 ${summary.budgetUsagePercent}%`}
            className="w-full h-3 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${badgeProps.barBg}`}
              style={{ width: `${Math.min(100, summary.budgetUsagePercent)}%` }}
            />
          </div>

          <p className="text-xs text-slate-400 flex items-center justify-between">
            <span>남은 생활비: {formatKRW(summary.remainingAllowance)}</span>
            <span>{badgeProps.desc}</span>
          </p>

          {/* Pace: the diagnosis, not just the plan. */}
          {summary.daysPassed >= 3 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-xs">
              <div className="flex items-center justify-between text-slate-400">
                <span>기간 {summary.periodProgressPercent}% 지남</span>
                <span
                  className={`font-semibold ${
                    summary.budgetUsagePercent > summary.periodProgressPercent + 10
                      ? 'text-rose-300'
                      : summary.budgetUsagePercent < summary.periodProgressPercent - 10
                        ? 'text-emerald-300'
                        : 'text-slate-300'
                  }`}
                >
                  생활비 {summary.budgetUsagePercent}% 사용 ·{' '}
                  {summary.budgetUsagePercent > summary.periodProgressPercent + 10
                    ? '빠름'
                    : summary.budgetUsagePercent < summary.periodProgressPercent - 10
                      ? '여유'
                      : '적정'}
                </span>
              </div>

              {summary.projectedDepletionDate ? (
                <p className="mt-1.5 border-t border-slate-800/70 pt-1.5 leading-relaxed text-slate-300">
                  <span className="font-semibold text-rose-300">
                    지금 속도면 {summary.projectedDepletionDate}에 생활비가 바닥납니다
                    {summary.projectedShortfallDays > 0 && ` (${summary.projectedShortfallDays}일 부족)`}
                  </span>
                  {summary.requiredDailyPace > 0 && (
                    <>
                      <br />
                      하루 {formatKRW(summary.requiredDailyPace)}로 줄이면 {summary.daysRemaining}일을 채울 수 있습니다.
                    </>
                  )}
                </p>
              ) : (
                <p className="mt-1.5 border-t border-slate-800/70 pt-1.5 text-slate-400">
                  현재 속도면 이번 주기 끝까지 생활비가 남습니다.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Cash track: how the salary splits before any spending happens. */}
        <div className="pt-3 border-t border-slate-800">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-slate-300">
              <Lock className="h-3.5 w-3.5 text-indigo-400" />
              이번 주기 생활비는 이렇게 나왔습니다
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-bold text-white">{formatKRW(summary.livingBudget)}</span>
              <button
                onClick={onStartPayday}
                className="rounded-md border border-slate-700 px-2 py-0.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
              >
                {summary.isBaselineLocked ? '다시 확정' : '확정하기'}
              </button>
            </div>
          </div>

          {/* One bar, four envelopes: the salary splitting is the whole story. */}
          {summary.planningIncome > 0 && (
            <div
              className="mb-2 flex h-4 w-full overflow-hidden rounded-full border border-slate-800 bg-slate-950"
              role="img"
              aria-label={`급여 ${formatKRW(summary.planningIncome)}이 계좌 고정 이체 ${formatKRW(summary.accountFixedOutflow)}, 카드대금 ${formatKRW(summary.cardSettlementOutflow)}, 저축 ${formatKRW(summary.savingsReserve)}, 생활비 ${formatKRW(summary.livingBudget)}으로 나뉩니다`}
            >
              {envelopeSegments.map(segment => (
                <span
                  key={segment.label}
                  className={`${segment.className} transition-[width] duration-700 ease-out motion-reduce:transition-none`}
                  style={{ width: `${(segment.amount / summary.planningIncome) * 100}%` }}
                />
              ))}
            </div>
          )}

          <dl className="space-y-1 rounded-xl border border-slate-800/60 bg-slate-950/40 p-3 text-xs">
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-1.5 text-slate-400">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                {summary.isProjected ? '급여 (입금 예정)' : '급여 입금'}
              </dt>
              <dd className={`font-bold ${summary.isProjected ? 'text-emerald-400/70 decoration-dotted underline underline-offset-4' : 'text-emerald-400'}`}>
                {formatKRW(summary.planningIncome)}
              </dd>
            </div>

            <AmountBreakdown
              label="− 계좌 고정 이체"
              amount={summary.accountFixedOutflow}
              amountClassName="text-slate-200"
              swatchClassName="bg-slate-500"
              rows={[
                { label: '이체 완료', value: summary.confirmedAccountFixedOutflow },
                { label: '남은 이체', value: summary.scheduledAccountFixedOutflow },
              ]}
            />

            <AmountBreakdown
              label="− 카드대금"
              amount={summary.cardSettlementOutflow}
              amountClassName={cardBillIsEstimated ? 'text-indigo-300/70 decoration-dotted underline underline-offset-4' : 'text-indigo-300'}
              swatchClassName="bg-indigo-500"
              rows={cardSettlementSummary.cards
                .filter(card => card.amount > 0)
                .map(card => ({
                  label: card.cardName,
                  value: card.amount,
                  hint: card.hasStatementWindow
                    ? `${card.usageStartDate} ~ ${card.usageEndDate} 사용분`
                    : `${card.usageYearMonth} 사용분 · 추정`,
                }))}
              emptyHint="이번 주기에 결제일이 오는 카드대금이 없습니다."
            />

            {summary.savingsReserve > 0 && (
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-slate-400">
                  <span aria-hidden className="h-2 w-2 rounded-sm bg-emerald-500" />
                  − 저축
                </dt>
                <dd className="font-semibold text-emerald-300">{formatKRW(summary.savingsReserve)}</dd>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-slate-800 pt-1.5">
              <dt className="flex items-center gap-1.5 font-semibold text-slate-200">
                <span aria-hidden className="h-2 w-2 rounded-sm bg-rose-500" />
                = 이번 주기 생활비
              </dt>
              <dd className="font-extrabold text-white">{formatKRW(summary.livingBudget)}</dd>
            </div>
          </dl>

          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            카드대금은 지난 주기에 쓴 돈의 청구서입니다. 이번 주기 생활비 사용에는 다시 더하지 않습니다.
          </p>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-800 pt-3 text-xs sm:grid-cols-2">
          <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800/60">
            <div className="text-slate-400 mb-1 flex items-center justify-between">
              <span>고정 출금 처리 현황</span>
              <Lock className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="font-bold text-sm text-indigo-300">
              {formatKRW(summary.accountFixedOutflow + summary.cardSettlementOutflow)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              이체 완료 {formatKRW(summary.confirmedAccountFixedOutflow)} | 남은 이체 {formatKRW(summary.scheduledAccountFixedOutflow)}
            </div>
          </div>

          <div className={`rounded-xl p-3 border ${
            summary.plannedSavings >= 0
              ? 'bg-emerald-500/5 border-emerald-500/20'
              : 'bg-rose-500/5 border-rose-500/20'
          }`}>
            <div className="text-slate-400 mb-1 flex items-center justify-between">
              <span>{summary.plannedSavings >= 0 ? '저축 예정액' : '생활비 한도 초과 설정'}</span>
              <Sparkles className={`w-3.5 h-3.5 ${summary.plannedSavings >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} />
            </div>
            <div className={`font-bold text-sm ${summary.plannedSavings >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {formatKRW(summary.plannedSavings >= 0 ? summary.plannedSavings : summary.allowanceOverCapacity)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              생활비 - 설정한 한도
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
                <h3 className="text-sm font-bold text-slate-100">카드 사용·고정비와 다음 결제</h3>
                <p className="text-xs text-slate-400">카드로 내는 고정지출도 해당 카드대금에 자동 합산</p>
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
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
              <div className="text-xs text-slate-400">이번 주기에 낼 카드대금</div>
              <div className="mt-1 text-base font-bold text-indigo-300">
                {formatKRW(summary.cardSettlementOutflow)}
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                {cardBillUsageLabel ? `${cardBillUsageLabel} 사용분` : '지난 주기 사용분'} · 생활비에서 이미 차감
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-xs text-slate-400">이번 주기 카드 사용</div>
              <div className="mt-1 text-base font-bold text-slate-100">{formatKRW(cardPaymentSummary.totalCardUsage)}</div>
              <div className="mt-0.5 text-xs text-slate-400">
                체크카드 {formatKRW(cardPaymentSummary.debitCardUsage)} · 미납부 고정비 {formatKRW(cardPaymentSummary.scheduledFixedCardUsage)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-xs text-slate-400">다음 청구 예정액</div>
              <div className="mt-1 text-base font-bold text-slate-100">
                {formatKRW(cardPaymentSummary.estimatedNextPaymentTotal)}
              </div>
              <div className="mt-0.5 text-xs text-slate-400">다음 주기 생활비에서 빠집니다</div>
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
                      <span>카드 고정비 {formatKRW(card.fixedAmount)} (예정 {formatKRW(card.scheduledFixedAmount)})</span>
                    </div>
                    {card.installmentAmount > 0 && (
                      <div className="mt-1.5 rounded-lg bg-indigo-500/10 px-2 py-1.5 text-xs text-indigo-200">
                        할부 예측 {formatKRW(card.installmentAmount)} · {card.installments.map(item => `${item.merchant} ${item.round}/${item.totalMonths}회차`).join(', ')}
                      </div>
                    )}
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
              카드 결제는 두 번 계산하지 않습니다. 카드를 긁은 금액은 <strong className="text-slate-300">그 주기의 생활비 사용</strong>으로,
              그 청구서는 <strong className="text-slate-300">결제일이 속한 주기의 카드대금</strong>으로 한 번씩만 반영합니다.
              카드 이용기간 마감일 정보가 없어 결제월 직전 달 사용분이 청구된다고 가정한 추정치입니다.
            </p>
          </details>
        </div>
      )}

      {/* 3. Month-End Forecast Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-md flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>현재 사용 속도 기준 주기말 예상 저축</span>
          </div>
          <div className="text-xl font-bold text-slate-100">
            {summary.forecastSavings !== null
              ? formatKRW(summary.forecastSavings)
              : summary.plannedSavings >= 0
                ? `생활비 한도를 지키면 ${formatKRW(summary.plannedSavings)} 저축 예정`
                : `현재 설정이면 ${formatKRW(summary.allowanceOverCapacity)} 부족`}
          </div>
          {summary.forecastVariableSpend !== null && (
            <p className="text-xs text-slate-400 mt-0.5">
              사용 가능 생활비 대비{' '}
              {summary.forecastVariableSpend > summary.spendableLimit ? (
                <span className="text-rose-400 font-semibold">
                  +{formatKRW(summary.forecastVariableSpend - summary.spendableLimit)} 초과 예상
                </span>
              ) : (
                <span className="text-emerald-400 font-semibold">
                  {formatKRW(summary.spendableLimit - summary.forecastVariableSpend)} 남길 예상
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
              <span>주의가 필요한 주요 생활비 지출</span>
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

      {/* 4. Pending recurring schedule for the selected accounting period */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-slate-200">이번 급여 주기의 미처리 정기 일정</h3>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              정기/고정 관리에서 등록한 항목 중 아직 거래로 확정하지 않은 수입·지출입니다. 금액은 해당 월에 저장된 계획 금액입니다.
            </p>
          </div>
          <button
            onClick={() => onNavigateTab('management', 'recurring')}
            className="text-xs text-rose-400 hover:text-rose-300 font-medium transition-colors flex items-center gap-1"
          >
            <span>정기 관리</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {pendingRecurringTimeline.length === 0 ? (
          <div className="space-y-2 rounded-lg border border-slate-800/60 bg-slate-950/40 py-6 text-center text-xs text-slate-400">
            <p>이번 급여 주기에 처리할 정기 수입·지출 일정이 없습니다.</p>
            <button
              onClick={() => onNavigateTab('management', 'recurring')}
              className="min-h-9 rounded-lg border border-slate-700 bg-slate-900 px-3 font-semibold text-slate-200 transition-colors hover:bg-slate-800"
            >
              정기 항목 추가
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {pendingRecurringTimeline.slice(0, 3).map(occ => {
              const template = recurringTemplates.find(candidate => candidate.id === occ.templateId);
              const type = occ.typeSnapshot || template?.type || 'expense';
              const statusLabel = occ.status === 'overdue'
                ? '예정일 지남'
                : occ.status === 'needs_confirmation'
                  ? '확인 필요'
                  : '자동 반영 예정';
              return (
                <div
                  key={occ.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-bold text-slate-100">{template?.name || '삭제된 정기 항목'}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                        type === 'income'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                      }`}>
                        {type === 'income' ? '정기 수입' : '고정 지출'}
                      </span>
                      <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
                        {statusLabel}
                      </span>
                    </div>
                    <div className="mt-1 text-slate-400">
                      {occ.scheduledDate} · {describeRecurringPaymentMethod(occ, template)}
                    </div>
                    <div className="mt-1 font-semibold text-slate-200">이번 달 계획 금액 {formatKRW(occ.expectedAmount)}</div>
                  </div>

                  <button
                    onClick={() => onConfirmOccurrence(occ.id)}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/20 px-3 py-1.5 font-medium text-emerald-300 transition-colors hover:bg-emerald-500/30"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>거래 확정</span>
                  </button>
                </div>
              );
            })}
            {pendingRecurringTimeline.length > 3 && (
              <button
                onClick={() => onNavigateTab('management', 'recurring')}
                className="w-full rounded-lg border border-slate-800 bg-slate-950/40 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                나머지 {pendingRecurringTimeline.length - 3}건 모두 보기
              </button>
            )}
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
