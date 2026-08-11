import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IDLE_LOCK_MINUTES,
  describeIdleLockMinutes,
  normalizeIdleLockMinutes,
} from './lockPolicy';
import { isDraftWorthKeeping } from './transactionDraft';

describe('idle lock policy', () => {
  it('falls back to the default for missing or unsupported values', () => {
    expect(normalizeIdleLockMinutes(undefined)).toBe(DEFAULT_IDLE_LOCK_MINUTES);
    expect(normalizeIdleLockMinutes(null)).toBe(DEFAULT_IDLE_LOCK_MINUTES);
    expect(normalizeIdleLockMinutes(7)).toBe(DEFAULT_IDLE_LOCK_MINUTES);
    expect(normalizeIdleLockMinutes(-5)).toBe(DEFAULT_IDLE_LOCK_MINUTES);
  });

  it('keeps every offered option, including the disabled one', () => {
    expect(normalizeIdleLockMinutes(5)).toBe(5);
    expect(normalizeIdleLockMinutes(60)).toBe(60);
    expect(normalizeIdleLockMinutes(0)).toBe(0);
  });

  it('describes each option in Korean', () => {
    expect(describeIdleLockMinutes(0)).toBe('사용 안 함');
    expect(describeIdleLockMinutes(15)).toBe('15분');
    expect(describeIdleLockMinutes(60)).toBe('1시간');
  });
});

describe('transaction draft', () => {
  const base = {
    type: 'expense' as const,
    amount: '',
    localDate: '2026-08-11',
    categoryId: 'food',
    merchant: '',
    memo: '',
    tagsText: '',
  };

  it('ignores an untouched form', () => {
    expect(isDraftWorthKeeping(base)).toBe(false);
    expect(isDraftWorthKeeping({ ...base, amount: '0' })).toBe(false);
    expect(isDraftWorthKeeping({ ...base, merchant: '   ' })).toBe(false);
  });

  it('keeps a draft once an amount or a merchant is entered', () => {
    expect(isDraftWorthKeeping({ ...base, amount: '24900' })).toBe(true);
    expect(isDraftWorthKeeping({ ...base, merchant: '스타벅스' })).toBe(true);
  });
});
