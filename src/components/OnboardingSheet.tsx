import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import { Modal } from './ui/Modal';
import { AmountInput } from './ui/AmountInput';
import { formatKRW } from '../utils/calculations';

export interface OnboardingResult {
  monthlyIncome: number;
  incomeDay: number;
  fixedExpense: number;
  fixedExpenseDay: number;
  allowanceLimit: number;
}

interface OnboardingSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSkip: () => void;
  onComplete: (result: OnboardingResult) => void;
}

/** Suggested starting points only; every value is edited before anything is created. */
const DEFAULTS = {
  monthlyIncome: 3_500_000,
  incomeDay: 25,
  fixedExpense: 1_200_000,
  fixedExpenseDay: 1,
  allowanceLimit: 800_000,
};

const STEP_COUNT = 3;

export const OnboardingSheet: React.FC<OnboardingSheetProps> = ({
  isOpen,
  onClose,
  onSkip,
  onComplete,
}) => {
  const [step, setStep] = useState(0);
  const [monthlyIncome, setMonthlyIncome] = useState(DEFAULTS.monthlyIncome);
  const [incomeDay, setIncomeDay] = useState(DEFAULTS.incomeDay);
  const [fixedExpense, setFixedExpense] = useState(DEFAULTS.fixedExpense);
  const [fixedExpenseDay, setFixedExpenseDay] = useState(DEFAULTS.fixedExpenseDay);
  const [allowanceLimit, setAllowanceLimit] = useState(DEFAULTS.allowanceLimit);

  const remainingAfterFixed = monthlyIncome - fixedExpense;
  const plannedSavings = remainingAfterFixed - allowanceLimit;
  const canAdvance = step === 0 ? monthlyIncome > 0 : step === 1 ? true : allowanceLimit > 0;

  const dayField = (label: string, value: number, onChange: (day: number) => void) => (
    <label className="block space-y-1.5">
      <span className="text-xs text-slate-400">{label}</span>
      <select
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm font-bold text-slate-100 focus:border-rose-500 focus:outline-none"
      >
        {Array.from({ length: 31 }, (_, index) => index + 1).map(day => (
          <option key={day} value={day}>매월 {day}일</option>
        ))}
      </select>
    </label>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledById="onboarding-title"
      dismissOnBackdrop={false}
      backdropClassName="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-md sm:items-center sm:p-4"
      panelClassName="w-full max-w-md space-y-4 rounded-t-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-2xl"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
          <Sparkles className="h-4 w-4" />
          <span>{step + 1} / {STEP_COUNT} 단계</span>
        </div>
        <h2 id="onboarding-title" className="text-base font-bold text-slate-100">
          {step === 0 && '월 수입을 알려주세요'}
          {step === 1 && '매달 나가는 고정비가 있나요?'}
          {step === 2 && '한 달 용돈 한도를 정해주세요'}
        </h2>
        <p className="text-xs leading-relaxed text-slate-400">
          {step === 0 && '급여처럼 매달 들어오는 금액입니다. 정기 수입 항목으로 등록됩니다.'}
          {step === 1 && '월세, 관리비, 생활비 송금처럼 매달 빠져나가는 금액입니다. 없으면 0으로 두고 넘어가세요.'}
          {step === 2 && '고정비를 뺀 돈 중에서 자유롭게 쓸 금액입니다. 홈의 오늘 안전 용돈이 이 값으로 계산됩니다.'}
        </p>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-rose-500 transition-all"
          style={{ width: `${((step + 1) / STEP_COUNT) * 100}%` }}
        />
      </div>

      {step === 0 && (
        <div className="space-y-3">
          <AmountInput value={monthlyIncome} onChange={setMonthlyIncome} showQuickAdd autoFocus />
          {dayField('입금일', incomeDay, setIncomeDay)}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <AmountInput value={fixedExpense} onChange={setFixedExpense} showQuickAdd autoFocus />
          {dayField('출금일', fixedExpenseDay, setFixedExpenseDay)}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <AmountInput value={allowanceLimit} onChange={setAllowanceLimit} showQuickAdd autoFocus />
          <dl className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">고정비 뺀 여유</dt>
              <dd className="font-semibold text-slate-100">{formatKRW(remainingAfterFixed)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-slate-800 pt-1.5">
              <dt className="text-slate-400">{plannedSavings >= 0 ? '저축 예정액' : '한도 초과'}</dt>
              <dd className={`font-bold ${plannedSavings >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatKRW(Math.abs(plannedSavings))}
              </dd>
            </div>
          </dl>
          {plannedSavings < 0 && (
            <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              용돈 한도가 수입에서 고정비를 뺀 금액보다 큽니다. 그대로 저장할 수 있지만 매달 부족해집니다.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-slate-800 pt-3">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep(current => current - 1)}
            className="flex min-h-11 items-center gap-1 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>이전</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSkip}
            className="min-h-11 rounded-xl px-3 text-xs font-semibold text-slate-400 transition-colors hover:text-slate-200"
          >
            나중에 하기
          </button>
        )}

        <button
          type="button"
          disabled={!canAdvance}
          onClick={() => {
            if (step < STEP_COUNT - 1) {
              setStep(current => current + 1);
              return;
            }
            onComplete({ monthlyIncome, incomeDay, fixedExpense, fixedExpenseDay, allowanceLimit });
          }}
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-500 px-4 text-xs font-bold text-white transition-colors hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {step < STEP_COUNT - 1 ? (
            <>
              <span>다음</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" />
              <span>설정 완료</span>
            </>
          )}
        </button>
      </div>
    </Modal>
  );
};
