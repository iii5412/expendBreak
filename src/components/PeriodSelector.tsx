import React from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { AccountingPeriod, formatPeriodRange, shiftYearMonth } from '../utils/calculations';

interface PeriodSelectorProps {
  period: AccountingPeriod;
  /** The period containing today, so past/future browsing can be called out. */
  currentYearMonth: string;
  onChange: (yearMonth: string) => void;
}

/**
 * Single app-wide period control. Every screen reads the same `currentYM`, so
 * this lives above the view switcher instead of inside one tab.
 */
export const PeriodSelector: React.FC<PeriodSelectorProps> = ({ period, currentYearMonth, onChange }) => {
  const [year, month] = period.yearMonth.split('-').map(Number);
  const rangeLabel = formatPeriodRange(period);
  const offsetFromNow = period.yearMonth.localeCompare(currentYearMonth);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 px-1 pb-3 pt-1">
        <button
          type="button"
          onClick={() => onChange(shiftYearMonth(period.yearMonth, -1))}
          aria-label="이전 기간"
          className="flex min-h-11 min-w-11 items-center justify-center text-slate-400 transition-colors hover:bg-slate-900 hover:text-slate-100"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="min-w-0 text-center">
          <div className="eb-display flex items-center justify-center gap-1.5 text-sm font-extrabold tracking-tight text-slate-100">
            <span>{year}년 {month}월 주기</span>
          </div>
          {rangeLabel && <div className="mt-0.5 text-xs text-slate-400">{rangeLabel}</div>}
        </div>

        <div className="flex items-center gap-1">
          {offsetFromNow !== 0 && (
            <button
              type="button"
              onClick={() => onChange(currentYearMonth)}
              className="flex min-h-11 items-center gap-1 border border-slate-700 bg-slate-950 px-2.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
            >
              <RotateCcw className="h-3 w-3" />
              <span>이번 달로</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange(shiftYearMonth(period.yearMonth, 1))}
            aria-label="다음 기간"
            className="flex min-h-11 min-w-11 items-center justify-center text-slate-400 transition-colors hover:bg-slate-900 hover:text-slate-100"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {offsetFromNow !== 0 && (
        <p
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
        >
          {offsetFromNow < 0 ? '지난 기간' : '다가올 기간'}을 조회 중입니다. 화면의 모든 금액이 이 기간 기준입니다.
        </p>
      )}
    </div>
  );
};
