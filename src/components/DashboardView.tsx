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
} from 'lucide-react';
import { MonthSummary, formatKRW } from '../utils/calculations';
import { RecurringOccurrence, Category } from '../types';

interface DashboardViewProps {
  summary: MonthSummary;
  upcomingOccurrences: RecurringOccurrence[];
  categories: Category[];
  categoryBreakdown: { categoryId: string; categoryName: string; amount: number; percent: number; color: string }[];
  onOpenAddModal: () => void;
  onNavigateTab: (tab: 'history' | 'analytics' | 'management', subTab?: string) => void;
  onConfirmOccurrence: (occId: string) => void;
  onApplyPresetOnboarding: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  summary,
  upcomingOccurrences,
  categories,
  categoryBreakdown,
  onOpenAddModal,
  onNavigateTab,
  onConfirmOccurrence,
  onApplyPresetOnboarding,
}) => {
  const getAlertBadgeProps = () => {
    switch (summary.alertLevel) {
      case 'safe':
        return {
          bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
          text: '안정 (0~69%)',
          desc: '안전한 지출 속도를 유지하고 있습니다.',
          icon: ShieldCheck,
          barBg: 'bg-emerald-500',
        };
      case 'caution':
        return {
          bg: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
          text: '주의 (70~84%)',
          desc: '월 한도의 70%를 넘었습니다. 잔여 한도를 확인하세요.',
          icon: AlertTriangle,
          barBg: 'bg-amber-500',
        };
      case 'warning':
        return {
          bg: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
          text: '위험 (85~99%)',
          desc: '한도가 얼마 남지 않았습니다! 필수 지출 외에는 동결을 권장합니다.',
          icon: ShieldAlert,
          barBg: 'bg-orange-500',
        };
      case 'danger':
      default:
        return {
          bg: 'bg-rose-500/15 text-rose-400 border-rose-500/40',
          text: '한도 초과 (100%+)',
          desc: '월 한도를 초과했습니다. 추가 지출 사유를 신중히 검토하세요.',
          icon: ShieldAlert,
          barBg: 'bg-rose-500',
        };
    }
  };

  const badgeProps = getAlertBadgeProps();
  const AlertIcon = badgeProps.icon;

  const topRisky = categoryBreakdown.slice(0, 3);

  return (
    <div className="space-y-6 pb-24">
      {/* 1. Core Safety Spending Card */}
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

        {/* Primary Focus: Today's Safe Spending Allowance */}
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="flex items-center gap-1.5 font-medium text-slate-300">
              <Zap className="w-4 h-4 text-amber-400" />
              오늘 안전 사용 가능액
            </span>
            <span className="text-[11px] text-slate-500">(안전 잔액 / 남은 {summary.daysRemaining}일)</span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-3xl font-extrabold text-white tracking-tight">
              {formatKRW(summary.dailySafeAllowance)}
            </div>
            <button
              onClick={onOpenAddModal}
              className="bg-rose-500 hover:bg-rose-600 text-white font-semibold text-xs px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1 shadow-md shadow-rose-950/30"
            >
              + 지출 기록
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2 border-t border-slate-800/60 pt-2 flex items-center justify-between">
            <span>남은 예정 고정지출을 차감한 진짜 안전액</span>
            <span className="font-semibold text-rose-300">안전잔액: {formatKRW(summary.safetyBalance)}</span>
          </p>
        </div>

        {/* Budget Usage Progress Bar */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">이번 달 실제 지출</span>
            <div className="text-slate-200 font-semibold">
              <span className="text-white font-bold">{formatKRW(summary.confirmedExpenses)}</span>
              <span className="text-slate-500"> / 한도 {formatKRW(summary.monthlyBudgetLimit)}</span>
              <span className="ml-2 font-bold text-rose-400">({summary.budgetUsagePercent}%)</span>
            </div>
          </div>

          <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${badgeProps.barBg}`}
              style={{ width: `${Math.min(100, summary.budgetUsagePercent)}%` }}
            />
          </div>

          <p className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>단순 남은 한도: {formatKRW(summary.simpleRemainingLimit)}</span>
            <span>{badgeProps.desc}</span>
          </p>
        </div>

        {/* 2-Column Cash Flow Overview */}
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-800 text-xs">
          <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800/60">
            <div className="text-slate-400 mb-1 flex items-center justify-between">
              <span>월 수입 현황</span>
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="font-bold text-sm text-emerald-400">{formatKRW(summary.totalIncome)}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              확정 {formatKRW(summary.confirmedIncome)} | 예정 {formatKRW(summary.scheduledIncome)}
            </div>
          </div>

          <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800/60">
            <div className="text-slate-400 mb-1 flex items-center justify-between">
              <span>남은 고정지출</span>
              <Lock className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="font-bold text-sm text-indigo-300">
              {formatKRW(summary.remainingScheduledExpenses)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              확정 고정비 {formatKRW(summary.confirmedFixedExpenses)}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Month-End Forecast Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-md flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>현재 지출 속도 기준 월말 예상 지출</span>
          </div>
          <div className="text-xl font-bold text-slate-100">
            {summary.forecastMonthEndSpend !== null
              ? formatKRW(summary.forecastMonthEndSpend)
              : '데이터 축적 중 (3일 이상 필요)'}
          </div>
          {summary.forecastMonthEndSpend !== null && (
            <p className="text-[11px] text-slate-400 mt-0.5">
              월 한도 대비{' '}
              {summary.forecastMonthEndSpend > summary.monthlyBudgetLimit ? (
                <span className="text-rose-400 font-semibold">
                  +{formatKRW(summary.forecastMonthEndSpend - summary.monthlyBudgetLimit)} 초과 예상
                </span>
              ) : (
                <span className="text-emerald-400 font-semibold">
                  {formatKRW(summary.monthlyBudgetLimit - summary.forecastMonthEndSpend)} 안전 세이브 예상
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
              <span>주의가 필요한 주요 지출 카테고리</span>
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
          <div className="text-center py-6 text-xs text-slate-500 bg-slate-950/40 rounded-lg border border-slate-800/60">
            이번 달 남은 정기 지출 및 수입 일정이 없습니다.
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
                    <span className="text-[10px] font-semibold bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700">
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

      {/* 5. Salaried Worker Onboarding Helper */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-700/60 rounded-xl p-4 flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-amber-300 text-xs font-bold">
            <Sparkles className="w-4 h-4" />
            <span>월급 생활자 추천 초기 설정</span>
          </div>
          <p className="text-xs text-slate-300">
            월급(350만) + 배우자 생활비(120만) + 주거관리비(38만) 예시 구성을 1초 만에 불러옵니다.
          </p>
        </div>

        <button
          onClick={onApplyPresetOnboarding}
          className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs px-3.5 py-2.5 rounded-lg whitespace-nowrap transition-colors shadow-md shadow-amber-950/20"
        >
          예시 적용하기
        </button>
      </div>
    </div>
  );
};
