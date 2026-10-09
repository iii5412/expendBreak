/**
 * Payday changes over time (PRD-ui-renewal §8 "급여일 변경").
 *
 * A payday change never rewrites the past: cycles that already exist keep the
 * boundaries they were created with. The new day applies from a chosen cycle
 * onward, and that first cycle is a "transition cycle" that starts the day
 * after the previous cycle ended and ends where the new day's normal cycle
 * ends, so no date is left out or counted twice.
 *
 * This module is pure date math with no imports so both `calculations` and
 * `recurringNormalization` can use it. The active schedule is registered once
 * from the user profile; when none is registered, callers fall back to the
 * single `monthStartDay` they were given.
 *
 * A single cycle can also start a few days early when payday falls on a
 * weekend or holiday and the salary arrives before it (cycle start
 * overrides). Only that cycle's start and the previous cycle's end move.
 */

export interface PaydayScheduleEntry {
  /** First cycle label (YYYY-MM) that uses this day. The base entry uses ''. */
  fromYearMonth: string;
  monthStartDay: number;
}

export interface PaydayPeriodBounds {
  yearMonth: string;
  monthStartDay: number;
  startDate: string;
  endDate: string;
  /** True for the first cycle after a payday change; its length is irregular. */
  isTransition: boolean;
  /** True when this cycle starts earlier than its payday (a cycle start override). */
  startAdvanced?: boolean;
}

/** Cycle label (YYYY-MM) -> the date (YYYY-MM-DD) that cycle actually starts. */
export type CycleStartOverrides = Record<string, string>;

/** How far ahead of payday a cycle may start; covers long holidays such as 추석. */
export const MAX_CYCLE_START_ADVANCE_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const clampDay = (day: number) => Math.min(28, Math.max(1, Math.trunc(Number(day)) || 1));

const toLocal = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const shift = (yearMonth: string, offset: number) => {
  const [year, month] = yearMonth.split('-').map(Number);
  const moved = new Date(year, month - 1 + offset, 1);
  return `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, '0')}`;
};

let activeSchedule: PaydayScheduleEntry[] | null = null;
let activeOverrides: CycleStartOverrides = {};

const addDays = (localDate: string, days: number) => {
  const [year, month, day] = localDate.split('-').map(Number);
  return toLocal(new Date(year, month - 1, day + days));
};

/** Keeps well-formed entries only; profile data comes from storage and sync. */
export function normalizeCycleStartOverrides(value?: Record<string, unknown> | null): CycleStartOverrides {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([yearMonth, date]) =>
    /^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth) && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))) as CycleStartOverrides;
}

/** Sorted, clamped, with one entry per label; null when it is just one day. */
export function normalizePaydaySchedule(entries?: PaydayScheduleEntry[] | null): PaydayScheduleEntry[] | null {
  if (!entries || entries.length === 0) return null;
  const byLabel = new Map<string, number>();
  entries.forEach(entry => byLabel.set(entry.fromYearMonth || '', clampDay(entry.monthStartDay)));
  const sorted = [...byLabel.entries()]
    .map(([fromYearMonth, monthStartDay]) => ({ fromYearMonth, monthStartDay }))
    .sort((left, right) => left.fromYearMonth.localeCompare(right.fromYearMonth));
  // Drop entries that do not change anything.
  const compact = sorted.filter((entry, index) => index === 0 || entry.monthStartDay !== sorted[index - 1].monthStartDay);
  return compact.length > 1 ? compact : null;
}

export function configurePaydaySchedule(
  entries?: PaydayScheduleEntry[] | null,
  options: { monthStartDay?: number; cycleStartOverrides?: Record<string, unknown> | null } = {},
) {
  activeOverrides = normalizeCycleStartOverrides(options.cycleStartOverrides);
  const schedule = normalizePaydaySchedule(entries);
  if (schedule || Object.keys(activeOverrides).length === 0) {
    activeSchedule = schedule;
    return;
  }
  // Overrides only apply through the schedule path, so a single payday becomes a one-entry schedule.
  const day = entries && entries.length > 0
    ? [...entries].sort((left, right) => (left.fromYearMonth || '').localeCompare(right.fromYearMonth || '')).slice(-1)[0].monthStartDay
    : options.monthStartDay ?? 1;
  activeSchedule = [{ fromYearMonth: '', monthStartDay: clampDay(day) }];
}

export function getActivePaydaySchedule(): PaydayScheduleEntry[] | null {
  return activeSchedule;
}

export function getActiveCycleStartOverrides(): CycleStartOverrides {
  return activeOverrides;
}

function entryIndexFor(yearMonth: string, schedule: PaydayScheduleEntry[]): number {
  let index = 0;
  for (let candidate = 0; candidate < schedule.length; candidate += 1) {
    if (schedule[candidate].fromYearMonth <= yearMonth) index = candidate;
  }
  return index;
}

export function startDayForYearMonth(yearMonth: string, schedule: PaydayScheduleEntry[]): number {
  return schedule[entryIndexFor(yearMonth, schedule)].monthStartDay;
}

function scheduledBoundsFor(yearMonth: string, schedule: PaydayScheduleEntry[]): PaydayPeriodBounds {
  const index = entryIndexFor(yearMonth, schedule);
  const entry = schedule[index];
  const [year, month] = yearMonth.split('-').map(Number);
  const nominalStart = new Date(year, month - 1, entry.monthStartDay);
  const nextStart = new Date(year, month, entry.monthStartDay);
  const endDate = toLocal(new Date(nextStart.getTime() - MS_PER_DAY));

  const isTransition = index > 0 && entry.fromYearMonth === yearMonth;
  if (!isTransition) {
    return { yearMonth, monthStartDay: entry.monthStartDay, startDate: toLocal(nominalStart), endDate, isTransition: false };
  }
  // The previous cycle still runs on the old day; continue from the day after it.
  const previous = scheduledBoundsFor(shift(yearMonth, -1), schedule);
  const [prevYear, prevMonth, prevDay] = previous.endDate.split('-').map(Number);
  const startDate = toLocal(new Date(prevYear, prevMonth - 1, prevDay + 1));
  return { yearMonth, monthStartDay: entry.monthStartDay, startDate, endDate, isTransition: true };
}

/**
 * The earliest date a cycle may start: up to {@link MAX_CYCLE_START_ADVANCE_DAYS}
 * before payday. A transition cycle already starts where the previous one
 * ended, so it cannot be moved; null then.
 */
export function cycleStartAdvanceRange(yearMonth: string, schedule: PaydayScheduleEntry[]) {
  const bounds = scheduledBoundsFor(yearMonth, schedule);
  if (bounds.isTransition) return null;
  return { earliest: addDays(bounds.startDate, -MAX_CYCLE_START_ADVANCE_DAYS), payday: bounds.startDate };
}

function overrideStartFor(yearMonth: string, schedule: PaydayScheduleEntry[], overrides: CycleStartOverrides) {
  const date = overrides[yearMonth];
  if (!date) return null;
  const range = cycleStartAdvanceRange(yearMonth, schedule);
  return range && date >= range.earliest && date < range.payday ? date : null;
}

export function periodBoundsFor(
  yearMonth: string,
  schedule: PaydayScheduleEntry[],
  overrides: CycleStartOverrides = activeOverrides,
): PaydayPeriodBounds {
  const bounds = scheduledBoundsFor(yearMonth, schedule);
  const start = overrideStartFor(yearMonth, schedule, overrides);
  const nextStart = overrideStartFor(shift(yearMonth, 1), schedule, overrides);
  return {
    ...bounds,
    startDate: start ?? bounds.startDate,
    endDate: nextStart ? addDays(nextStart, -1) : bounds.endDate,
    ...(start ? { startAdvanced: true } : {}),
  };
}

/** The cycle label containing a date; a transition cycle can span parts of three calendar months. */
export function yearMonthForDateInSchedule(localDate: string, schedule: PaydayScheduleEntry[]): string {
  const calendarMonth = localDate.slice(0, 7);
  // +1: a cycle that starts early can begin in the previous calendar month.
  for (const offset of [1, 0, -1, -2]) {
    const candidate = shift(calendarMonth, offset);
    const bounds = periodBoundsFor(candidate, schedule);
    if (localDate >= bounds.startDate && localDate <= bounds.endDate) return candidate;
  }
  // Cannot happen with contiguous cycles; keep the plain rule as a guard.
  const day = Number(localDate.slice(8, 10));
  return day >= startDayForYearMonth(calendarMonth, schedule) ? calendarMonth : shift(calendarMonth, -1);
}

/**
 * Schedule after the user picks a new payday. The change applies from
 * `effectiveFrom`; a pending change that has not started yet is replaced
 * rather than stacked.
 */
export function planPaydayChange(
  current: PaydayScheduleEntry[] | null,
  currentDay: number,
  newDay: number,
  effectiveFrom: string,
): PaydayScheduleEntry[] {
  const base: PaydayScheduleEntry[] = current && current.length > 0
    ? current.filter(entry => entry.fromYearMonth < effectiveFrom)
    : [{ fromYearMonth: '', monthStartDay: clampDay(currentDay) }];
  return [...base, { fromYearMonth: effectiveFrom, monthStartDay: clampDay(newDay) }];
}
