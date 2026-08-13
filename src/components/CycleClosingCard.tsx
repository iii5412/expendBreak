import React from 'react';
import { ArrowRight, PartyPopper, TrendingDown, TrendingUp } from 'lucide-react';
import { formatKRW, formatPeriodRange } from '../utils/calculations';
import { CycleClosingReport } from '../utils/cycleClosing';

/**
 * The previous cycle's plan against what actually happened, shown once the new
 * cycle begins. Without this the payday plan is a promise nobody checks.
 */

interface CycleClosingCardProps {
  report: CycleClosingReport;
  onReviewUnresolved: () => void;
  onDismiss: () => void;
  /** Carries the leftover into the new cycle's savings target. */
  onCarryLeftoverToSavings: (amount: number) => void;
}

export const CycleClosingCard: React.FC<CycleClosingCardProps> = ({
  report,
  onReviewUnresolved,
  onDismiss,
  onCarryLeftoverToSavings,
}) => {
  const saved = report.leftover >= 0;
  const periodRange = formatPeriodRange(report.period);

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-gradient-to-b from-slate-900 to-slate-900/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-100">
            {report.yearMonth} 주기 마감
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {periodRange || `${report.period.startDate} ~ ${report.period.endDate}`}
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-400 transition-colors hover:bg-slate-800"
        >
          닫기
        </button>
      </div>

      <dl className="mt-3 space-y-1 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-slate-400">계획 생활비</dt>
          <dd className="font-semibold text-slate-200">{formatKRW(report.plannedLivingBudget)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-400">실제 사용</dt>
          <dd className="font-semibold text-slate-200">{formatKRW(report.actualSpend)}</dd>
        </div>
        <div className="flex items-center justify-between border-t border-slate-800 pt-1.5">
          <dt className="flex items-center gap-1.5 font-semibold text-slate-200">
            {saved ? <PartyPopper className="h-3.5 w-3.5 text-emerald-400" /> : <TrendingUp className="h-3.5 w-3.5 text-rose-400" />}
            {saved ? '남긴 돈' : '초과한 금액'}
          </dt>
          <dd className={`font-extrabold ${saved ? 'text-emerald-300' : 'text-rose-300'}`}>
            {formatKRW(Math.abs(report.leftover))}
          </dd>
        </div>
      </dl>

      {report.topCategories.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1.5 text-xs font-semibold text-slate-300">가장 많이 쓴 곳</h4>
          <ul className="space-y-1.5">
            {report.topCategories.map(category => (
              <li key={category.categoryName} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                  <span className="truncate text-slate-300">{category.categoryName}</span>
                  <span className="shrink-0 text-slate-500">{category.percent}%</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-semibold text-slate-100">{formatKRW(category.amount)}</span>
                  {category.delta !== 0 && (
                    <span className={`flex items-center gap-0.5 ${category.delta > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {category.delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {formatKRW(Math.abs(category.delta))}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {report.unresolvedOccurrences.length > 0 && (
          <button
            onClick={onReviewUnresolved}
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/10"
          >
            <span>미처리로 남은 정기 항목 {report.unresolvedOccurrences.length}건</span>
            <span className="flex items-center gap-1">
              확인하고 정리
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </button>
        )}

        {saved && report.leftover > 0 && (
          <button
            onClick={() => onCarryLeftoverToSavings(report.leftover)}
            className="min-h-11 w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs font-bold text-emerald-300 transition-colors hover:bg-emerald-500/20"
          >
            남긴 {formatKRW(report.leftover)}을 이번 주기 저축 목표로
          </button>
        )}
      </div>
    </div>
  );
};
