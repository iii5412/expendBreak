import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPaydayFunding,
  getLatestPaydayPaymentBatch,
  getPaydayFunding,
  markPaydayPaymentBatchUndone,
  savePaydayFunding,
  savePaydayPaymentBatch,
  clearPaydayPaymentState,
} from './paydayPaymentState';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});
const sessionValues = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    clear: () => sessionValues.clear(),
    getItem: (key: string) => sessionValues.get(key) ?? null,
    setItem: (key: string, value: string) => sessionValues.set(key, value),
    removeItem: (key: string) => sessionValues.delete(key),
  },
});

describe('payday payment state', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('stores funding per cycle and account group', () => {
    savePaydayFunding('2026-09', 'account:a', 120_400.4);
    expect(getPaydayFunding('2026-09', 'account:a')?.amount).toBe(120_400);
    expect(getPaydayFunding('2026-10', 'account:a')).toBeNull();
    clearPaydayFunding('2026-09', 'account:a');
    expect(getPaydayFunding('2026-09', 'account:a')).toBeNull();
  });

  it('only returns an active payment batch until it is undone', () => {
    const batch = savePaydayPaymentBatch('2026-09', 'account:a', ['recurring:1', 'card:2']);
    expect(getLatestPaydayPaymentBatch('2026-09', 'account:a')?.itemIds).toEqual(['recurring:1', 'card:2']);
    expect(markPaydayPaymentBatchUndone(batch!.id)).toBe(true);
    expect(getLatestPaydayPaymentBatch('2026-09', 'account:a')).toBeNull();
  });

  it('isolates preparation records per signed-in account and clears only the active account', () => {
    sessionStorage.setItem('eb_session_account', JSON.stringify({ uid: 'a', name: 'A', isOwner: false }));
    savePaydayFunding('2026-09', 'account:one', 10_000);
    sessionStorage.setItem('eb_session_account', JSON.stringify({ uid: 'b', name: 'B', isOwner: false }));
    expect(getPaydayFunding('2026-09', 'account:one')).toBeNull();
    savePaydayFunding('2026-09', 'account:one', 20_000);
    clearPaydayPaymentState();
    expect(getPaydayFunding('2026-09', 'account:one')).toBeNull();
    sessionStorage.setItem('eb_session_account', JSON.stringify({ uid: 'a', name: 'A', isOwner: false }));
    expect(getPaydayFunding('2026-09', 'account:one')?.amount).toBe(10_000);
  });
});
