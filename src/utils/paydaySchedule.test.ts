import { afterEach, describe, expect, it } from 'vitest';
import {
  configurePaydaySchedule,
  normalizePaydaySchedule,
  periodBoundsFor,
  planPaydayChange,
  yearMonthForDateInSchedule,
} from './paydaySchedule';
import { getAccountingPeriod, getYearMonthForDate } from './calculations';

afterEach(() => configurePaydaySchedule(null));

describe('payday change schedule (PRD-ui-renewal §8 급여일 변경)', () => {
  const laterPayday = planPaydayChange(null, 10, 25, '2026-11');
  const earlierPayday = planPaydayChange(null, 25, 10, '2026-11');

  it('keeps cycles before the change on the old day', () => {
    expect(periodBoundsFor('2026-10', laterPayday)).toMatchObject({ startDate: '2026-10-10', endDate: '2026-11-09', monthStartDay: 10, isTransition: false });
  });

  it('builds a transition cycle from the day after the old cycle to the new day\'s normal end', () => {
    expect(periodBoundsFor('2026-11', laterPayday)).toMatchObject({ startDate: '2026-11-10', endDate: '2026-12-24', isTransition: true });
    expect(periodBoundsFor('2026-12', laterPayday)).toMatchObject({ startDate: '2026-12-25', endDate: '2027-01-24', isTransition: false });
  });

  it('shortens the transition cycle when payday moves earlier, never overlapping', () => {
    expect(periodBoundsFor('2026-10', earlierPayday)).toMatchObject({ startDate: '2026-10-25', endDate: '2026-11-24' });
    expect(periodBoundsFor('2026-11', earlierPayday)).toMatchObject({ startDate: '2026-11-25', endDate: '2026-12-09', isTransition: true });
    expect(periodBoundsFor('2026-12', earlierPayday)).toMatchObject({ startDate: '2026-12-10', endDate: '2027-01-09' });
  });

  it('assigns every date to exactly one cycle across the change (acceptance #17)', () => {
    for (const schedule of [laterPayday, earlierPayday]) {
      const cursor = new Date(2026, 8, 1);
      let previous = '';
      for (let day = 0; day < 200; day += 1) {
        const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
        const cycle = yearMonthForDateInSchedule(date, schedule);
        const bounds = periodBoundsFor(cycle, schedule);
        expect(date >= bounds.startDate && date <= bounds.endDate).toBe(true);
        expect(cycle >= previous).toBe(true);
        previous = cycle;
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  });

  it('routes the shared period helpers through the registered schedule', () => {
    configurePaydaySchedule(laterPayday);
    expect(getAccountingPeriod('2026-11', 10)).toMatchObject({ startDate: '2026-11-10', endDate: '2026-12-24', daysInMonth: 45, isTransition: true });
    expect(getYearMonthForDate('2026-12-20', 10)).toBe('2026-11');
    expect(getYearMonthForDate('2026-10-15', 10)).toBe('2026-10');
  });

  it('replaces a pending change instead of stacking it', () => {
    const replaced = planPaydayChange(laterPayday, 10, 15, '2026-11');
    expect(replaced).toEqual([{ fromYearMonth: '', monthStartDay: 10 }, { fromYearMonth: '2026-11', monthStartDay: 15 }]);
  });

  it('normalizes a schedule that changes nothing to null', () => {
    expect(normalizePaydaySchedule([{ fromYearMonth: '', monthStartDay: 10 }])).toBeNull();
    expect(normalizePaydaySchedule([{ fromYearMonth: '', monthStartDay: 10 }, { fromYearMonth: '2026-11', monthStartDay: 10 }])).toBeNull();
  });
});

describe('cycle that starts early because payday is a weekend or holiday', () => {
  const single = [{ fromYearMonth: '', monthStartDay: 10 }];
  // 2026-10-10 is a Saturday; the salary came on Friday the 9th.
  const early = { '2026-10': '2026-10-09' };

  it('moves only that cycle\'s start and the previous cycle\'s end', () => {
    expect(periodBoundsFor('2026-09', single, early)).toMatchObject({ startDate: '2026-09-10', endDate: '2026-10-08' });
    expect(periodBoundsFor('2026-10', single, early)).toMatchObject({ startDate: '2026-10-09', endDate: '2026-11-09', startAdvanced: true });
    expect(periodBoundsFor('2026-11', single, early)).toMatchObject({ startDate: '2026-11-10', endDate: '2026-12-09' });
  });

  it('ignores overrides that are later than payday or more than a week early', () => {
    expect(periodBoundsFor('2026-10', single, { '2026-10': '2026-10-12' }).startDate).toBe('2026-10-10');
    expect(periodBoundsFor('2026-10', single, { '2026-10': '2026-10-02' }).startDate).toBe('2026-10-10');
  });

  it('does not move a transition cycle after a payday change', () => {
    const changed = planPaydayChange(null, 10, 25, '2026-11');
    expect(periodBoundsFor('2026-11', changed, { '2026-11': '2026-11-08' }).startDate).toBe('2026-11-10');
  });

  it('applies a single payday with overrides through the shared helpers', () => {
    configurePaydaySchedule(null, { monthStartDay: 10, cycleStartOverrides: early });
    expect(getYearMonthForDate('2026-10-09', 10)).toBe('2026-10');
    expect(getYearMonthForDate('2026-10-08', 10)).toBe('2026-09');
    expect(getAccountingPeriod('2026-10', 10)).toMatchObject({ startDate: '2026-10-09', daysInMonth: 32, startAdvanced: true });
    expect(getAccountingPeriod('2026-09', 10)).toMatchObject({ endDate: '2026-10-08', daysInMonth: 29 });
  });

  it('finds the cycle for a date when day-1 cycles start in the previous month', () => {
    configurePaydaySchedule(null, { monthStartDay: 1, cycleStartOverrides: { '2026-11': '2026-10-30' } });
    expect(getYearMonthForDate('2026-10-30', 1)).toBe('2026-11');
    expect(getYearMonthForDate('2026-10-29', 1)).toBe('2026-10');
  });

  it('assigns every date to exactly one cycle with overrides', () => {
    const overrides = { '2026-10': '2026-10-09', '2027-01': '2027-01-04' };
    const cursor = new Date(2026, 8, 1);
    let previous = '';
    for (let day = 0; day < 200; day += 1) {
      const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      configurePaydaySchedule(null, { monthStartDay: 10, cycleStartOverrides: overrides });
      const cycle = yearMonthForDateInSchedule(date, single);
      const bounds = periodBoundsFor(cycle, single);
      expect(date >= bounds.startDate && date <= bounds.endDate).toBe(true);
      expect(cycle >= previous).toBe(true);
      previous = cycle;
      cursor.setDate(cursor.getDate() + 1);
    }
  });
});
