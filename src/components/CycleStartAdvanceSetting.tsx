import React from 'react';
import { UserProfile } from '../types';
import { getCurrentYearMonth, getLocalDateString, normalizeMonthStartDay, shiftYearMonth } from '../utils/calculations';
import {
  cycleStartAdvanceRange,
  getActivePaydaySchedule,
  MAX_CYCLE_START_ADVANCE_DAYS,
  normalizeCycleStartOverrides,
} from '../utils/paydaySchedule';
import { useToast } from './ui/FeedbackProvider';

interface CycleStartAdvanceSettingProps {
  userProfile: UserProfile;
  onUpdateUserProfile: (updates: Partial<UserProfile>) => void;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const parseLocal = (localDate: string) => {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const formatDay = (localDate: string) => {
  const date = parseLocal(localDate);
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]})`;
};

const cycleName = (yearMonth: string) => `${Number(yearMonth.slice(0, 4))}년 ${Number(yearMonth.slice(5, 7))}월 주기`;

/**
 * Lets one cycle start a few days before payday, for months when payday is a
 * weekend or holiday and the salary arrives early. Only the current and next
 * cycle are offered; earlier cycles keep whatever they were closed with.
 */
export const CycleStartAdvanceSetting: React.FC<CycleStartAdvanceSettingProps> = ({
  userProfile,
  onUpdateUserProfile,
}) => {
  const { showToast } = useToast();
  const monthStartDay = normalizeMonthStartDay(userProfile.monthStartDay);
  const schedule = getActivePaydaySchedule() ?? [{ fromYearMonth: '', monthStartDay }];
  const overrides = normalizeCycleStartOverrides(userProfile.cycleStartOverrides);
  const currentCycle = getCurrentYearMonth(monthStartDay);
  const today = getLocalDateString();

  const rows = [currentCycle, shiftYearMonth(currentCycle, 1)].flatMap(yearMonth => {
    const range = cycleStartAdvanceRange(yearMonth, schedule);
    if (!range) return [];
    const options = Array.from({ length: MAX_CYCLE_START_ADVANCE_DAYS + 1 }, (_, index) => {
      const date = parseLocal(range.payday);
      date.setDate(date.getDate() - index);
      return getLocalDateString(date);
    });
    const saved = overrides[yearMonth];
    return [{ yearMonth, payday: range.payday, options, selected: saved && options.includes(saved) ? saved : range.payday }];
  });

  const change = (yearMonth: string, payday: string, date: string) => {
    const next = { ...overrides };
    if (date === payday) delete next[yearMonth];
    else next[yearMonth] = date;
    onUpdateUserProfile({ cycleStartOverrides: Object.keys(next).length > 0 ? next : null });
    showToast({
      message: date === payday
        ? `${cycleName(yearMonth)}를 급여일(${formatDay(payday)})부터 시작합니다.`
        : `${cycleName(yearMonth)}를 ${formatDay(date)}부터 시작합니다.`,
      description: date === payday ? undefined : '앞 주기는 그 전날까지로 짧아집니다.',
      tone: 'success',
    });
  };

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
      <p className="font-bold text-slate-200">급여가 일찍 들어온 달</p>
      <p className="text-xs leading-relaxed text-slate-400">
        급여일이 주말이나 공휴일이라 급여가 먼저 들어오면, 그 주기만 시작일을 앞당길 수 있습니다. 최대 {MAX_CYCLE_START_ADVANCE_DAYS}일까지 가능합니다.
      </p>
      {rows.map(row => {
        const weekday = parseLocal(row.payday).getDay();
        const weekend = weekday === 0 || weekday === 6;
        return (
          <label key={row.yearMonth} className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-slate-300">
              {cycleName(row.yearMonth)}
              {row.yearMonth === currentCycle && row.selected <= today && <span className="text-slate-500"> (진행 중)</span>}
              {weekend && row.selected === row.payday && (
                <span className="block text-[11px] text-amber-300">급여일 {formatDay(row.payday)}이 주말입니다</span>
              )}
            </span>
            <select
              value={row.selected}
              onChange={event => change(row.yearMonth, row.payday, event.target.value)}
              aria-label={`${cycleName(row.yearMonth)} 시작일`}
              className="shrink-0 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-bold text-slate-100 focus:border-rose-500 focus:outline-none"
            >
              {row.options.map(date => (
                <option key={date} value={date}>
                  {formatDay(date)}{date === row.payday ? ' 급여일' : ''}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
};
