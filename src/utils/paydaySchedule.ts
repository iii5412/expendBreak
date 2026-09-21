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
}

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

export function configurePaydaySchedule(entries?: PaydayScheduleEntry[] | null) {
  activeSchedule = normalizePaydaySchedule(entries);
}

export function getActivePaydaySchedule(): PaydayScheduleEntry[] | null {
  return activeSchedule;
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

export function periodBoundsFor(yearMonth: string, schedule: PaydayScheduleEntry[]): PaydayPeriodBounds {
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
  const previous = periodBoundsFor(shift(yearMonth, -1), schedule);
  const [prevYear, prevMonth, prevDay] = previous.endDate.split('-').map(Number);
  const startDate = toLocal(new Date(prevYear, prevMonth - 1, prevDay + 1));
  return { yearMonth, monthStartDay: entry.monthStartDay, startDate, endDate, isTransition: true };
}

/** The cycle label containing a date; a transition cycle can span parts of three calendar months. */
export function yearMonthForDateInSchedule(localDate: string, schedule: PaydayScheduleEntry[]): string {
  const calendarMonth = localDate.slice(0, 7);
  for (const offset of [0, -1, -2]) {
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
