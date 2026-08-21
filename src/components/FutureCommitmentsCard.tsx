import React from 'react';
import { CalendarClock, PartyPopper } from 'lucide-react';
import { formatKRW } from '../utils/calculations';
import { FutureCommitmentSummary } from '../utils/futureCommitments';

/**
 * Six cycles of already-committed outflow, stacked so an installment ending is
 * visible as the bar getting shorter. The point is "when does this free up",
 * which no other screen answers.
 */

interface FutureCommitmentsCardProps {
  summary: FutureCommitmentSummary;
}

const SEGMENTS = [
  { key: 'accountFixed', label: '계좌 고정지출', className: 'bg-slate-500' },
  { key: 'installments', label: '할부', className: 'bg-blue-300' },
  { key: 'cardSettlement', label: '카드대금', className: 'bg-blue-500' },
] as const;

export const FutureCommitmentsCard: React.FC<FutureCommitmentsCardProps> = ({ summary }) => {
  if (summary.peak <= 0) return null;

  return (
    <section className="eb-panel rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100">
            <CalendarClock className="h-4 w-4 text-blue-300" />
            앞으로 6주기에 이미 정해진 지출
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            계좌 고정지출과 카드대금 이체를 분리했습니다. 이번 달 1일~말일 카드 사용분은 다음 달 카드대금에 한 번만 반영합니다.
          </p>
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
        {SEGMENTS.map(segment => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${segment.className}`} />
            <span>{segment.label}</span>
          </li>
        ))}
      </ul>

      <ol className="mt-3 space-y-2">
        {summary.months.map(month => (
          <li key={month.yearMonth} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">{month.yearMonth}</span>
              <span className="eb-tabular font-bold text-slate-100">{formatKRW(month.total)}</span>
            </div>

            <div
              className="flex h-3 w-full overflow-hidden border border-slate-800 bg-slate-950"
              role="img"
              aria-label={`${month.yearMonth} 확정 지출 ${formatKRW(month.total)}: 계좌 고정지출 ${formatKRW(month.accountFixed)}, 할부 ${formatKRW(month.installments)}, 카드대금 ${formatKRW(month.cardSettlement)}`}
            >
              {SEGMENTS.map(segment => {
                const value = month[segment.key];
                if (value <= 0) return null;
                return (
                  <span
                    key={segment.key}
                    className={segment.className}
                    style={{ width: `${(value / summary.peak) * 100}%` }}
                  />
                );
              })}
            </div>

            {month.endingInstallments.length > 0 && (
              <p className="flex items-start gap-1 text-xs text-emerald-300">
                <PartyPopper className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  {month.endingInstallments
                    .map(item => `${item.merchant} ${item.totalMonths}회 할부 종료`)
                    .join(', ')}
                  {' · 다음 주기부터 매달 '}
                  {formatKRW(month.endingInstallments.reduce((sum, item) => sum + item.amount, 0))}
                  {' 여유'}
                </span>
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
};
