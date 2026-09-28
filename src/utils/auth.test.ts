import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/auth', () => ({
  browserLocalPersistence: { type: 'LOCAL' },
  browserSessionPersistence: { type: 'SESSION' },
  onAuthStateChanged: vi.fn(() => () => undefined),
  setPersistence: vi.fn().mockResolvedValue(undefined),
  signInWithCustomToken: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/firebase', () => ({ auth: {} }));
vi.mock('./api', () => ({ apiUrl: (path: string) => path }));

import { onAuthStateChanged, setPersistence, signInWithCustomToken } from 'firebase/auth';
import {
  authenticatedFetch,
  consumePinUpgradeNotice,
  getAccountStorageKey,
  getSignedInAccount,
  isOwnerLoggedIn,
  loginWithPin,
  logoutOwner,
  onSessionExpired,
  revokeOtherSessions,
  watchFirebaseSession,
} from './auth';

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

  it('surfaces a one-time PIN upgrade notice without persisting it in the account', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      token: 'session-token',
      firebaseToken: 'firebase-token',
      account: { uid: 'owner', name: '내 계정', isOwner: true },
      pinUpgradeRequired: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await loginWithPin('1234');

    expect(sessionStorage.getItem('eb_session_account')).not.toContain('pinUpgradeRequired');
    expect(consumePinUpgradeNotice()).toBe(true);
    expect(consumePinUpgradeNotice()).toBe(false);
  });

  it('shows no upgrade notice after a 6-digit PIN login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      token: 'session-token',
      firebaseToken: 'firebase-token',
      account: { uid: 'owner', name: '내 계정', isOwner: true },
      pinUpgradeRequired: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await loginWithPin('123456');
    expect(consumePinUpgradeNotice()).toBe(false);
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const loginResponse = () => json({
  token: 'session-token',
  firebaseToken: 'firebase-token',
  account: { uid: 'owner', name: '내 계정', isOwner: true },
});

describe('session expiry and revocation', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.clearAllMocks();
  });

  it('sends the "remember" choice so the server can pick the token lifetime', async () => {
    const fetchMock = vi.fn().mockResolvedValue(loginResponse());
    vi.stubGlobal('fetch', fetchMock);
    await loginWithPin('123456', false);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ key: '123456', remember: false });
    expect(sessionStorage.getItem('eb_session_token')).toBe('session-token');
  });

  it('reports one expiry when several API calls get 401, and again after the next login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(loginResponse());
    vi.stubGlobal('fetch', fetchMock);
    await loginWithPin('123456', true);

    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    fetchMock.mockImplementation(async () => json({ error: 'session_revoked' }, 401));
    const responses = await Promise.all([
      authenticatedFetch('/api/ai/receipt', { method: 'POST' }),
      authenticatedFetch('/api/ai/feedback', { method: 'POST' }),
      authenticatedFetch('/api/ai/finance-chat', { method: 'POST' }),
    ]);
    expect(responses.map(response => response.status)).toEqual([401, 401, 401]);
    expect(expired).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(loginResponse());
    await loginWithPin('123456', true);
    await authenticatedFetch('/api/ai/receipt', { method: 'POST' });
    expect(expired).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('does not treat other failures as an expired session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(loginResponse());
    vi.stubGlobal('fetch', fetchMock);
    await loginWithPin('123456', true);
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    fetchMock.mockResolvedValue(json({ error: 'account_unknown' }, 403));
    await authenticatedFetch('/api/ai/receipt');
    fetchMock.mockResolvedValue(json({}, 503));
    await authenticatedFetch('/api/ai/receipt');
    expect(expired).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('treats an unrequested Firebase sign-out as an expired session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(loginResponse()));
    await loginWithPin('123456', true);
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    watchFirebaseSession();
    const onChange = vi.mocked(onAuthStateChanged).mock.calls[0][1] as (user: unknown) => void;

    onChange(null); // initial "no user yet" while persistence restores
    expect(expired).not.toHaveBeenCalled();
    onChange({ uid: 'owner' });
    onChange(null); // refresh token revoked
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("replaces this device's sessions after revoking the others, keeping the storage choice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(loginResponse());
    vi.stubGlobal('fetch', fetchMock);
    await loginWithPin('123456', true);

    fetchMock.mockResolvedValue(json({ token: 'new-session', firebaseToken: 'new-firebase' }));
    await revokeOtherSessions();

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/auth/revoke-others');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer session-token');
    expect(JSON.parse(init.body)).toEqual({ remember: true });
    expect(signInWithCustomToken).toHaveBeenLastCalledWith({}, 'new-firebase');
    expect(localStorage.getItem('eb_session_token')).toBe('new-session');
    expect(sessionStorage.getItem('eb_session_token')).toBeNull();
  });
});
