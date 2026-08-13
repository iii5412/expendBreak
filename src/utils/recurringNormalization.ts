import { RecurringOccurrence, RecurringTemplate } from '../types';

const toLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const adjustForWeekend = (dateText: string, policy: RecurringTemplate['holidayPolicy']) => {
  if (policy === 'fixed_date') return dateText;
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const direction = policy === 'previous_business_day' ? -1 : 1;
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + direction);
  return toLocalDate(date);
};

/**
 * Which salary cycle a date belongs to. Duplicated from `calculations` on
 * purpose: that module already imports this one, and the rule is four lines.
 */
const cycleOf = (dateText: string, monthStartDay: number) => {
  const startDay = Math.min(28, Math.max(1, Math.trunc(monthStartDay) || 1));
  const [year, month] = dateText.split('-').map(Number);
  const day = Number(dateText.slice(8, 10));
  if (day >= startDay) return dateText.slice(0, 7);
  const previous = new Date(year, month - 2, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * A weekend shift moves the payment date, never the cycle it belongs to.
 *
 * With payday on the 10th, salary due 2026-10-10 (Saturday) shifted back to
 * 10-09 and landed inside the 9/10~10/9 cycle, which already held 9/10: the
 * cycle counted the salary twice and the next one lost it. When the configured
 * policy would cross the boundary the date moves the other way instead.
 */
const adjustWithinCycle = (
  nominalDate: string,
  policy: RecurringTemplate['holidayPolicy'],
  monthStartDay: number,
) => {
  const adjusted = adjustForWeekend(nominalDate, policy);
  const cycle = cycleOf(nominalDate, monthStartDay);
  if (cycleOf(adjusted, monthStartDay) === cycle) return adjusted;

  const reversed = adjustForWeekend(
    nominalDate,
    policy === 'previous_business_day' ? 'next_business_day' : 'previous_business_day',
  );
  return cycleOf(reversed, monthStartDay) === cycle ? reversed : nominalDate;
};

export function getScheduledDatesForMonth(
  template: RecurringTemplate,
  yearMonth: string,
  monthStartDay: number = 1,
): string[] {
  const [year, month] = yearMonth.split('-').map(Number);
  const monthStart = `${yearMonth}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

  if (!template.active || (template.endDate && template.endDate < monthStart) || template.startDate > monthEnd) {
    return [];
  }

  if (template.frequency === 'weekly') {
    const [startYear, startMonth, startDay] = template.startDate.split('-').map(Number);
    const cursor = new Date(startYear, startMonth - 1, startDay);
    while (toLocalDate(cursor) < monthStart) cursor.setDate(cursor.getDate() + 7);
    const dates: string[] = [];
    while (toLocalDate(cursor) <= monthEnd) {
      const dateText = toLocalDate(cursor);
      if (!template.endDate || dateText <= template.endDate) {
        dates.push(adjustWithinCycle(dateText, template.holidayPolicy, monthStartDay));
      }
      cursor.setDate(cursor.getDate() + 7);
    }
    return [...new Set(dates)];
  }

  const clampedDay = Math.min(Math.max(1, template.dayOfMonth), lastDay);
  const dateText = `${yearMonth}-${String(clampedDay).padStart(2, '0')}`;
  if (dateText < template.startDate || (template.endDate && dateText > template.endDate)) return [];
  return [adjustWithinCycle(dateText, template.holidayPolicy, monthStartDay)];
}

export interface NormalizedRecurringOccurrences {
  occurrences: RecurringOccurrence[];
  removedIds: string[];
}

/**
 * Removes obsolete, unposted occurrences left behind by due-date/template changes.
 * Posted records are historical evidence and are never deleted.
 */
export function normalizeRecurringOccurrencesForMonth(
  occurrences: RecurringOccurrence[],
  templates: RecurringTemplate[],
  yearMonth: string,
  monthStartDay: number = 1,
): NormalizedRecurringOccurrences {
  const templateMap = new Map(templates.map(template => [template.id, template]));
  const removedIds = new Set<string>();

  const monthOccurrences = occurrences.filter(occurrence => occurrence.scheduledDate.startsWith(`${yearMonth}-`));
  const templateIds = new Set(monthOccurrences.map(occurrence => occurrence.templateId));

  templateIds.forEach(templateId => {
    const template = templateMap.get(templateId);
    const candidates = monthOccurrences.filter(occurrence => occurrence.templateId === templateId);
    const canonicalDates = new Set(
      template ? getScheduledDatesForMonth(template, yearMonth, monthStartDay) : [],
    );

    if (!template || !template.active) {
      candidates.filter(occurrence => occurrence.status !== 'posted').forEach(occurrence => removedIds.add(occurrence.id));
      return;
    }

    // A completed monthly item remains historical even if its configured day
    // changes later. Do not add a second occurrence for the same calendar month.
    if (template.frequency === 'monthly' && candidates.some(occurrence => occurrence.status === 'posted')) {
      candidates.filter(occurrence => occurrence.status !== 'posted').forEach(occurrence => removedIds.add(occurrence.id));
      return;
    }

    candidates
      .filter(occurrence => occurrence.status !== 'posted' && !canonicalDates.has(occurrence.scheduledDate))
      .forEach(occurrence => removedIds.add(occurrence.id));

    canonicalDates.forEach(date => {
      const duplicates = candidates
        .filter(occurrence => occurrence.scheduledDate === date && !removedIds.has(occurrence.id))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      const posted = duplicates.find(occurrence => occurrence.status === 'posted');
      const keeper = posted || duplicates[0];
      duplicates.forEach(occurrence => {
        if (keeper && occurrence.id !== keeper.id && occurrence.status !== 'posted') removedIds.add(occurrence.id);
      });
    });
  });

  return {
    occurrences: occurrences.filter(occurrence => !removedIds.has(occurrence.id)),
    removedIds: [...removedIds],
  };
}
