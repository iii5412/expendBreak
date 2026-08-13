import React from 'react';
import { AlertTriangle, LineChart } from 'lucide-react';
import { formatKRW } from '../utils/calculations';
import { CashflowTimeline } from '../utils/cashflowTimeline';

/**
 * Balance across the cycle as a single line, with the zero axis drawn so a dip
 * below it is unmissable. Inline SVG rather than a chart library: this is one
 * series with one threshold, and it has to stay legible at phone width.
 */

interface CashflowTimelineCardProps {
  timeline: CashflowTimeline;
}

const WIDTH = 320;
const HEIGHT = 110;
const PADDING = 6;

export const CashflowTimelineCard: React.FC<CashflowTimelineCardProps> = ({ timeline }) => {
  if (!timeline.hasStartingBalance || timeline.points.length < 2) return null;

  const balances = timeline.points.map(point => point.balance);
  const maxBalance = Math.max(...balances, 0);
  const minBalance = Math.min(...balances, 0);
  const range = maxBalance - minBalance || 1;

  const x = (index: number) => PADDING + (index / (timeline.points.length - 1)) * (WIDTH - PADDING * 2);
  const y = (balance: number) => PADDING + ((maxBalance - balance) / range) * (HEIGHT - PADDING * 2);

  const firstProjectedIndex = timeline.points.findIndex(point => point.projected);
  const confirmedPoints = firstProjectedIndex === -1 ? timeline.points : timeline.points.slice(0, firstProjectedIndex + 1);
  const projectedPoints = firstProjectedIndex === -1 ? [] : timeline.points.slice(Math.max(0, firstProjectedIndex - 1));

  const toPath = (points: typeof timeline.points, offset: number) => points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index + offset).toFixed(1)} ${y(point.balance).toFixed(1)}`)
    .join(' ');

  const shortLabel = (date: string) => {
    const [, month, day] = date.split('-').map(Number);
    return `${month}/${day}`;
  };

  const majorEvents = timeline.points
    .filter(point => point.events.some(event => Math.abs(event.amount) >= 100_000))
    .slice(0, 4);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100">
            <LineChart className="h-4 w-4 text-emerald-300" />
            이번 주기 잔고 흐름
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            입력한 계좌 잔액에서 확정된 입출금과 현재 소비 속도를 반영한 추정입니다.
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-3 h-28 w-full"
        role="img"
        aria-label={
          timeline.shortfallDate
            ? `${shortLabel(timeline.shortfallDate)}에 잔고가 마이너스로 내려갑니다. 최저 잔고 ${formatKRW(timeline.lowestBalance)}.`
            : `주기 내내 잔고가 0원 위를 유지합니다. 최저 잔고 ${formatKRW(timeline.lowestBalance)}.`
        }
      >
        {/* Zero axis: the line that matters. */}
        <line
          x1={PADDING}
          x2={WIDTH - PADDING}
          y1={y(0)}
          y2={y(0)}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 3"
          className={timeline.shortfallDate ? 'text-rose-500/60' : 'text-slate-700'}
        />
        <path d={toPath(confirmedPoints, 0)} fill="none" strokeWidth={2} stroke="currentColor" className="text-emerald-400" />
        {projectedPoints.length > 1 && (
          <path
            d={toPath(projectedPoints, Math.max(0, firstProjectedIndex - 1))}
            fill="none"
            strokeWidth={2}
            strokeDasharray="4 3"
            stroke="currentColor"
            className="text-slate-500"
          />
        )}
      </svg>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{shortLabel(timeline.points[0].date)}</span>
        <span>{shortLabel(timeline.points[timeline.points.length - 1].date)}</span>
      </div>

      {timeline.shortfallDate ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs leading-relaxed text-rose-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {shortLabel(timeline.shortfallDate)}에 잔고가 마이너스로 내려갑니다.
            그 전에 카드대금 결제일을 확인하거나 지출 속도를 줄여 주세요.
          </span>
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-400">
          최저 잔고 {formatKRW(timeline.lowestBalance)} · 주기 내내 0원 위를 유지합니다.
        </p>
      )}

      {majorEvents.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-slate-800 pt-2 text-xs">
          {majorEvents.map(point => (
            <li key={point.date} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-slate-400">
                {shortLabel(point.date)} · {point.events.map(event => event.label).join(', ')}
              </span>
              <span className={`shrink-0 font-semibold ${
                point.events.reduce((sum, event) => sum + event.amount, 0) >= 0 ? 'text-emerald-300' : 'text-slate-300'
              }`}>
                {formatKRW(point.events.reduce((sum, event) => sum + event.amount, 0))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
