import React from 'react';
import { ArrowRight, CreditCard, Info } from 'lucide-react';
import { MonthSummary, formatKRW } from '../utils/calculations';
import { Modal } from './ui/Modal';

/**
 * Shown once after the two-track cash model lands.
 *
 * The card bill now leaves the account inside the plan, so the money the app
 * calls spare drops by roughly one month of card usage. That looks like the app
 * lost money unless it says plainly that the previous figure was wrong.
 */

interface CashflowModelNoticeProps {
  isOpen: boolean;
  summary: MonthSummary;
  onAcknowledge: () => void;
}

export const CashflowModelNotice: React.FC<CashflowModelNoticeProps> = ({
  isOpen,
  summary,
  onAcknowledge,
}) => {
  // What the old model reported: the card bill was absent from every total.
  const previousFixedOutflow = summary.accountFixedOutflow;
  const previousSavings = summary.allowanceLimit > 0
    ? summary.planningIncome - previousFixedOutflow - summary.allowanceLimit
    : summary.planningIncome - previousFixedOutflow;
  const currentSavings = summary.plannedSavings;

  const rows = [
    {
      label: '급여일에 확보할 고정 출금',
      before: previousFixedOutflow,
      after: summary.accountFixedOutflow + summary.cardSettlementOutflow,
    },
    { label: '저축 예정액', before: previousSavings, after: currentSavings },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onAcknowledge}
      ariaLabel="계산 방식 변경 안내"
      dismissOnBackdrop={false}
      panelClassName="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5"
    >
      <div className="space-y-4">
        <header className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-500/15">
              <CreditCard className="h-4 w-4 text-indigo-300" />
            </div>
            <h2 className="text-base font-bold text-white">카드대금을 예산에 반영했습니다</h2>
          </div>
          <p className="text-xs leading-relaxed text-slate-300">
            지금까지 이 앱은 매달 통장에서 빠지는 <strong className="text-slate-100">카드대금을 예산 계산에서 빠뜨리고</strong> 있었습니다.
            그래서 쓸 수 있는 돈과 저축 예정액이 실제보다 크게 나왔습니다. 이번 업데이트로 바로잡았습니다.
          </p>
        </header>

        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="mb-2 grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 text-[11px] font-semibold text-slate-400">
            <span>항목</span>
            <span className="text-right">이전</span>
            <span aria-hidden />
            <span className="text-right">지금</span>
          </div>
          <dl className="space-y-2 text-xs">
            {rows.map(row => (
              <div key={row.label} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
                <dt className="text-slate-300">{row.label}</dt>
                <dd className="text-right text-slate-500 line-through">{formatKRW(row.before)}</dd>
                <ArrowRight className="h-3 w-3 text-slate-600" aria-hidden />
                <dd className="text-right font-bold text-white">{formatKRW(row.after)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
            <Info className="h-3.5 w-3.5 text-slate-400" />
            <span>줄어든 만큼이 없어진 것은 아닙니다</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            이번 주기에 낼 카드대금 {formatKRW(summary.cardSettlementOutflow)}은 원래도 통장에서 나가던 돈입니다.
            앱이 그만큼을 계산에 넣지 않았을 뿐입니다. 카드로 긁은 금액은 쓴 주기의 생활비에,
            그 청구서는 결제하는 주기의 고정 출금에 한 번씩만 잡힙니다.
          </p>
        </div>

        <button
          type="button"
          onClick={onAcknowledge}
          className="min-h-11 w-full rounded-lg bg-slate-100 text-xs font-extrabold text-slate-950 transition-colors hover:bg-white"
        >
          확인했습니다
        </button>
      </div>
    </Modal>
  );
};
