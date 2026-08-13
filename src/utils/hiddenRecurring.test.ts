import { describe, expect, it } from 'vitest';
import { findHiddenRecurringItems } from './hiddenRecurring';
import { getAccountingPeriod } from './calculations';
import type { RecurringOccurrence, RecurringTemplate } from '../types';

const SALARY_DAY = 25;
/** 2026-08 cycle with payday on the 25th: 8/25 ~ 9/24. */
const PERIOD = getAccountingPeriod('2026-08', SALARY_DAY, new Date('2026-09-01T09:00:00'));

const makeTemplate = (overrides: Partial<RecurringTemplate>): RecurringTemplate => ({
  id: 't_1',
  type: 'expense',
  name: '월세',
  defaultAmount: 700_000,
  categoryId: 'housing_utilities',
  counterparty: '',
  frequency: 'monthly',
  dayOfMonth: 1,
  holidayPolicy: 'fixed_date',
  postingMode: 'confirm',
  allowAmountChange: true,
  paymentMethodType: 'account',
  startDate: '2026-01-01',
  nextDueDate: '2026-09-01',
  active: true,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const makeOccurrence = (templateId: string, scheduledDate: string): RecurringOccurrence => ({
  id: `occ_${templateId}_${scheduledDate}`,
  templateId,
  occurrenceKey: `${templateId}_${scheduledDate}`,
  scheduledDate,
  expectedAmount: 700_000,
  actualAmount: null,
  status: 'needs_confirmation',
  typeSnapshot: 'expense',
  categoryIdSnapshot: 'housing_utilities',
  createdAt: '',
  updatedAt: '',
});

describe('hidden recurring items', () => {
  it('does not report items that already have a row in this period', () => {
    const rent = makeTemplate({});
    const hidden = findHiddenRecurringItems(
      [rent],
      [makeOccurrence(rent.id, '2026-09-01')],
      PERIOD,
    );

    expect(hidden).toEqual([]);
  });

  it('reports a posted item as present, not hidden', () => {
    const rent = makeTemplate({});
    const posted = { ...makeOccurrence(rent.id, '2026-09-01'), status: 'posted' as const };

    expect(findHiddenRecurringItems([rent], [posted], PERIOD)).toEqual([]);
  });

  it('places a due day before the payday boundary in the same cycle', () => {
    // The cycle labelled 2026-08 runs 8/25~9/24, so the 20th is 9/20 and belongs
    // here. Nothing is hidden — this is the boundary users expect to lose items to.
    const insurance = makeTemplate({ id: 't_ins', name: '보험료', dayOfMonth: 20 });
    const hidden = findHiddenRecurringItems(
      [insurance],
      [makeOccurrence('t_ins', '2026-09-20')],
      PERIOD,
    );

    expect(hidden).toEqual([]);
  });

  it('explains an item whose term ends part-way through this cycle', () => {
    // Last payment was 8/20, inside the previous cycle; this cycle's 9/20 falls
    // past the end date, so the item is legitimately absent rather than lost.
    const loan = makeTemplate({ id: 't_loan', name: '대출 상환', dayOfMonth: 20, endDate: '2026-09-01' });
    const hidden = findHiddenRecurringItems([loan], [], PERIOD);

    expect(hidden).toHaveLength(1);
    expect(hidden[0].reason).toBe('other_cycle');
    expect(hidden[0].otherCycleDate).toBe('2026-08-20');
  });

  it('separates deactivated, ended and not-yet-started items', () => {
    const templates = [
      makeTemplate({ id: 't_off', name: '해지한 구독', active: false }),
      makeTemplate({ id: 't_end', name: '끝난 할부', endDate: '2026-07-31' }),
      makeTemplate({ id: 't_new', name: '다음 달부터', startDate: '2026-10-01' }),
    ];

    expect(findHiddenRecurringItems(templates, [], PERIOD).map(item => item.reason)).toEqual([
      'inactive',
      'ended',
      'not_started',
    ]);
  });

  it('keeps an item registered after its own due day inside the cycle it was added to', () => {
    // Registered 9/10 with a due day of the 5th. 9/5 sits in the same 8/25~9/24
    // cycle, so this payment belongs here; only its row is missing.
    const gym = makeTemplate({ id: 't_gym', name: '헬스장', dayOfMonth: 5, startDate: '2026-09-10' });

    expect(findHiddenRecurringItems([gym], [], PERIOD)[0].reason).toBe('not_generated');
    expect(findHiddenRecurringItems([gym], [makeOccurrence('t_gym', '2026-09-05')], PERIOD)).toEqual([]);
  });

  it('marks a manual card bill that the generated settlement replaced', () => {
    const manualBill = makeTemplate({ id: 't_bill', name: '신한카드 대금' });
    const hidden = findHiddenRecurringItems([manualBill], [], PERIOD, {
      replacedTemplateIds: ['t_bill'],
    });

    expect(hidden[0].reason).toBe('card_settlement_replaced');
  });

  it('flags a due item with no generated row so the user can reload', () => {
    const hidden = findHiddenRecurringItems([makeTemplate({})], [], PERIOD);

    expect(hidden[0].reason).toBe('not_generated');
  });

  it('only inspects the requested type', () => {
    const salary = makeTemplate({ id: 't_pay', type: 'income', name: '급여', dayOfMonth: 20 });

    expect(findHiddenRecurringItems([salary], [], PERIOD)).toEqual([]);
    expect(findHiddenRecurringItems([salary], [], PERIOD, { type: 'income' })).toHaveLength(1);
  });
});
