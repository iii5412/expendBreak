import { describe, expect, it } from 'vitest';
import { RecurringOccurrence, Transaction } from '../types';
import { resolveRecurringAmount } from './recurringAmounts';

const occurrence = (overrides: Partial<RecurringOccurrence>): RecurringOccurrence => ({
  id: 'occ',
  templateId: 'maintenance',
  occurrenceKey: 'maintenance_2026-09-25',
  scheduledDate: '2026-09-25',
  expectedAmount: 250_000,
  actualAmount: null,
  status: 'needs_confirmation',
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
  ...overrides,
});

const transaction = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx',
  type: 'expense',
  amount: 325_280,
  localDate: '2026-09-25',
  categoryId: 'housing',
  merchant: '관리비',
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
  ...overrides,
} as Transaction);

describe('resolveRecurringAmount', () => {
  it('reads a posted amount from the linked transaction and flags a disagreeing legacy amount', () => {
    // Acceptance #1: 250,000 vs 325,280 must be detected, not hidden.
    const resolved = resolveRecurringAmount(
      occurrence({ status: 'posted', actualAmount: 250_000, transactionId: 'tx' }),
      [transaction({ id: 'tx', amount: 325_280 })],
    );
    expect(resolved).toMatchObject({ amount: 325_280, status: 'confirmed', source: 'transaction', integrityIssue: true });
  });

  it('finds the linked transaction by occurrence key when no id is stored', () => {
    const resolved = resolveRecurringAmount(
      occurrence({ status: 'posted', actualAmount: 325_280 }),
      [transaction({ id: 'other', amount: 325_280, recurringOccurrenceKey: 'maintenance_2026-09-25' })],
    );
    expect(resolved).toMatchObject({ amount: 325_280, status: 'confirmed', integrityIssue: false });
  });

  it('prefers the explicit cycle amount state over legacy fields', () => {
    const resolved = resolveRecurringAmount(occurrence({
      expectedAmount: 999, actualAmount: 888,
      plannedAmount: 65_000, amountStatus: 'suggested', amountSource: 'previous_cycle', sourceCycle: '2026-08',
    }));
    expect(resolved).toEqual({ amount: 65_000, status: 'suggested', source: 'previous_cycle', sourceCycle: '2026-08', integrityIssue: false });
  });

  it('distinguishes a missing amount from a confirmed zero', () => {
    // Acceptance #4/#9: null is "unknown"; 0 is a real decision.
    expect(resolveRecurringAmount(occurrence({ plannedAmount: null, amountStatus: 'missing' })).amount).toBeNull();
    expect(resolveRecurringAmount(occurrence({ plannedAmount: 0, amountStatus: 'confirmed', amountSource: 'manual' })))
      .toMatchObject({ amount: 0, status: 'confirmed' });
  });

  it('migrates legacy rows: a manual actualAmount is confirmed, an expectedAmount is only a suggestion', () => {
    expect(resolveRecurringAmount(occurrence({ actualAmount: 70_000 })))
      .toMatchObject({ amount: 70_000, status: 'confirmed', source: 'legacy_occurrence' });
    expect(resolveRecurringAmount(occurrence({ expectedAmount: 250_000 })))
      .toMatchObject({ amount: 250_000, status: 'suggested', source: 'legacy_occurrence' });
    expect(resolveRecurringAmount(occurrence({ expectedAmount: 0 })))
      .toMatchObject({ amount: null, status: 'missing' });
  });
});
