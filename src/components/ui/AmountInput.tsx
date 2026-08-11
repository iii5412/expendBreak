import React from 'react';
import { MAX_AMOUNT, formatAmountInput, formatKoreanAmountUnits, parseAmountInput } from '../../utils/amount';

const QUICK_ADD = [10_000, 50_000, 100_000];

interface AmountInputProps {
  id?: string;
  value: number;
  onChange: (amount: number) => void;
  placeholder?: string;
  className?: string;
  /** Shows +1만 / +5만 / +10만 chips and a clear button. */
  showQuickAdd?: boolean;
  invalid?: boolean;
  describedById?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * KRW amount field. Renders a thousands-separated text input rather than
 * `type="number"`: Korean amounts are long enough that unseparated digits are
 * hard to verify, and a text input avoids the scroll-wheel value changes and
 * inconsistent mobile keypads of a number input.
 */
export const AmountInput: React.FC<AmountInputProps> = ({
  id,
  value,
  onChange,
  placeholder = '예: 24,900',
  className = '',
  showQuickAdd = false,
  invalid = false,
  describedById,
  autoFocus,
  disabled,
}) => {
  const readout = formatKoreanAmountUnits(value);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={formatAmountInput(value)}
          onChange={event => onChange(parseAmountInput(event.target.value))}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedById}
          autoFocus={autoFocus}
          disabled={disabled}
          className={`w-full rounded-lg border bg-slate-950 py-2.5 pl-3 pr-8 text-right font-extrabold text-slate-100 placeholder-slate-600 focus:outline-none disabled:opacity-50 ${
            invalid ? 'border-rose-500' : 'border-slate-800 focus:border-rose-500'
          } ${className}`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
          원
        </span>
      </div>

      {showQuickAdd && (
        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_ADD.map(step => (
            <button
              key={step}
              type="button"
              disabled={disabled}
              onClick={() => onChange(Math.min(MAX_AMOUNT, value + step))}
              className="min-h-9 rounded-lg border border-slate-800 bg-slate-950 px-2.5 text-[11px] font-semibold text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              +{formatKoreanAmountUnits(step)}
            </button>
          ))}
          {value > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(0)}
              className="min-h-9 rounded-lg px-2 text-[11px] text-slate-500 transition-colors hover:text-slate-300"
            >
              지우기
            </button>
          )}
        </div>
      )}

      {readout && (
        <p className="text-right text-[11px] text-slate-400" aria-hidden="true">
          {readout}
        </p>
      )}
    </div>
  );
};
