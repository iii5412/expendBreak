import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/auth', () => ({
  signInWithCustomToken: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../lib/firebase', () => ({ auth: {} }));

import { getAccountStorageKey, getSignedInAccount } from './auth';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

describe('account-scoped browser storage', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', new MemoryStorage());
  });

  it('keeps the original owner cache keys backward compatible', () => {
    expect(getSignedInAccount()).toEqual({ uid: 'owner', name: '내 계정', isOwner: true });
    expect(getAccountStorageKey('brake_transactions')).toBe('brake_transactions');
  });

  it('isolates an added account under its Firebase UID', () => {
    sessionStorage.setItem('eb_session_account', JSON.stringify({
      uid: 'wife',
      name: '와이프',
      isOwner: false,
    }));

    expect(getSignedInAccount()).toEqual({ uid: 'wife', name: '와이프', isOwner: false });
    expect(getAccountStorageKey('brake_transactions')).toBe('brake_transactions:wife');
    expect(getAccountStorageKey('brake_firestore_outbox')).toBe('brake_firestore_outbox:wife');
  });

  it('does not allow a secondary UID to escape the namespace by toggling isOwner', () => {
    sessionStorage.setItem('eb_session_account', JSON.stringify({
      uid: 'wife',
      name: '와이프',
      isOwner: true,
    }));

    expect(getAccountStorageKey('brake_transactions')).toBe('brake_transactions:wife');
  });
});
