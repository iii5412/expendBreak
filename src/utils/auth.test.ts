import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/auth', () => ({
  browserLocalPersistence: { type: 'LOCAL' },
  browserSessionPersistence: { type: 'SESSION' },
  setPersistence: vi.fn().mockResolvedValue(undefined),
  signInWithCustomToken: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/firebase', () => ({ auth: {} }));

import { setPersistence } from 'firebase/auth';
import { getAccountStorageKey, getSignedInAccount, isOwnerLoggedIn, loginWithPin, logoutOwner } from './auth';

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
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.clearAllMocks();
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

  it('keeps a remembered session in persistent storage without saving the PIN', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      token: 'session-token',
      firebaseToken: 'firebase-token',
      account: { uid: 'owner', name: '내 계정', isOwner: true },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await loginWithPin('1234', true);

    expect(setPersistence).toHaveBeenCalledWith({}, { type: 'LOCAL' });
    expect(localStorage.getItem('eb_session_token')).toBe('session-token');
    expect(localStorage.getItem('eb_session_account')).toContain('owner');
    expect(localStorage.getItem('pin')).toBeNull();
    expect(sessionStorage.getItem('eb_session_token')).toBeNull();
    expect(isOwnerLoggedIn()).toBe(true);

    await logoutOwner();
    expect(isOwnerLoggedIn()).toBe(false);
  });
});
