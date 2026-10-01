import { apiUrl } from './api';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { recordFailedRequest } from './requestErrors';

const SESSION_TOKEN_KEY = 'eb_session_token';
const SESSION_ACCOUNT_KEY = 'eb_session_account';
const PIN_UPGRADE_NOTICE_KEY = 'eb_pin_upgrade_notice';

function availableStorage(kind: 'session' | 'local'): Storage | null {
  try {
    if (kind === 'session') {
      return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    }
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readStoredValue(key: string): string | null {
  return availableStorage('session')?.getItem(key)
    || availableStorage('local')?.getItem(key)
    || null;
}

function clearStoredSession() {
  for (const storage of [availableStorage('session'), availableStorage('local')]) {
    storage?.removeItem(SESSION_TOKEN_KEY);
    storage?.removeItem(SESSION_ACCOUNT_KEY);
  }
  availableStorage('session')?.removeItem(PIN_UPGRADE_NOTICE_KEY);
}

/** True once after a login with a PIN shorter than 6 digits, so the app can ask for a longer one. */
export function consumePinUpgradeNotice(): boolean {
  const storage = availableStorage('session');
  if (storage?.getItem(PIN_UPGRADE_NOTICE_KEY) !== '1') return false;
  storage.removeItem(PIN_UPGRADE_NOTICE_KEY);
  return true;
}

export interface SignedInAccount {
  uid: string;
  name: string;
  isOwner: boolean;
}

export interface PinLoginError extends Error {
  status?: number;
  retryAfterMs?: number;
}

type AuthStateListener = (loggedIn: boolean) => void;
const listeners = new Set<AuthStateListener>();

export function onSessionStateChanged(listener: AuthStateListener): () => void {
  listeners.add(listener);
  listener(isOwnerLoggedIn());
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Fired when the server rejects the session (401) or Firebase signs the user
 * out on its own, e.g. after `session:revoke`. The app answers by locking; the
 * interrupted request is never retried automatically, so an AI call cannot run twice.
 */
type SessionExpiredListener = () => void;
const expiredListeners = new Set<SessionExpiredListener>();
let expiryReported = false;

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}

function reportSessionExpired() {
  // Several requests in flight can all fail at once; the app needs one signal.
  if (expiryReported || !isOwnerLoggedIn()) return;
  expiryReported = true;
  expiredListeners.forEach(fn => fn());
}

/**
 * Revoked Firebase refresh tokens stop working when the current ID token
 * expires (at most an hour); the SDK then signs out, which also ends the
 * Firestore listeners. A sign-out the app did not ask for means the session is over.
 */
export function watchFirebaseSession(): () => void {
  let hadUser = false;
  return onAuthStateChanged(auth, user => {
    if (user) {
      hadUser = true;
      return;
    }
    if (hadUser) reportSessionExpired();
  });
}

function notifyAuthState() {
  const loggedIn = isOwnerLoggedIn();
  listeners.forEach(fn => fn(loggedIn));
}

export function isOwnerLoggedIn(): boolean {
  return Boolean(readStoredValue(SESSION_TOKEN_KEY));
}

export function getSignedInAccount(): SignedInAccount {
  try {
    const raw = readStoredValue(SESSION_ACCOUNT_KEY);
    if (raw) {
      const account = JSON.parse(raw) as Partial<SignedInAccount>;
      if (account.uid && /^[A-Za-z0-9._-]{1,64}$/.test(account.uid)) {
        return {
          uid: account.uid,
          name: typeof account.name === 'string' && account.name.trim() ? account.name.trim() : '사용자',
          isOwner: Boolean(account.isOwner),
        };
      }
    }
  } catch {
    // A malformed legacy session is safely treated as the original owner.
  }
  return { uid: 'owner', name: '내 계정', isOwner: true };
}

/** Keeps the original owner's cache keys compatible while isolating every added account. */
export function getAccountStorageKey(baseKey: string): string {
  const { uid, isOwner } = getSignedInAccount();
  return isOwner && uid === 'owner' ? baseKey : `${baseKey}:${uid}`;
}

export async function loginWithPin(pin: string, rememberLogin = false) {
  const response = await fetch(apiUrl('/api/auth/verify-key'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: pin, remember: rememberLogin }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.token || !data.firebaseToken || !data.account?.uid) {
    const error = new Error(
      response.status === 429
        ? 'PIN 입력이 잠시 제한되었습니다.'
        : data.message || data.error || 'PIN이 일치하지 않습니다.',
    ) as PinLoginError;
    error.status = response.status;
    error.retryAfterMs = Number(data.retryAfterMs || 0);
    throw error;
  }

  await setPersistence(auth, rememberLogin ? browserLocalPersistence : browserSessionPersistence);
  await signInWithCustomToken(auth, data.firebaseToken);
  const account: SignedInAccount = {
    uid: String(data.account.uid),
    name: String(data.account.name || '사용자'),
    isOwner: Boolean(data.account.isOwner),
  };
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(account.uid)) {
    await signOut(auth).catch(() => undefined);
    throw new Error('서버에서 올바르지 않은 계정 정보를 받았습니다.');
  }
  const targetStorage = availableStorage(rememberLogin ? 'local' : 'session');
  if (!targetStorage) {
    await signOut(auth).catch(() => undefined);
    throw new Error('이 기기에서 로그인 세션을 저장할 수 없습니다.');
  }
  clearStoredSession();
  targetStorage.setItem(SESSION_TOKEN_KEY, data.token);
  targetStorage.setItem(SESSION_ACCOUNT_KEY, JSON.stringify(account));
  if (data.pinUpgradeRequired === true) availableStorage('session')?.setItem(PIN_UPGRADE_NOTICE_KEY, '1');
  expiryReported = false;
  notifyAuthState();
  return account;
}

export async function getOwnerIdToken() {
  const token = readStoredValue(SESSION_TOKEN_KEY);
  if (!token) throw new Error('PIN 로그인이 필요합니다.');
  return token;
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = await getOwnerIdToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const target = typeof input === 'string' && input.startsWith('/') ? apiUrl(input) : input;
  const response = await fetch(target, { ...init, headers });
  if (!response.ok) {
    recordFailedRequest({
      method: init.method,
      url: typeof target === 'string' ? target : target instanceof URL ? target.href : target.url,
      status: response.status,
      requestId: response.headers.get('X-Request-Id'),
    });
  }
  // Every session problem is a 401 (session_missing/invalid/expired/revoked).
  if (response.status === 401) reportSessionExpired();
  return response;
}

/**
 * Signs every other device out. The server revokes this device's tokens too,
 * so it swaps in the fresh API and Firebase sessions it gets back, keeping the
 * current "로그인 유지" choice.
 */
export async function revokeOtherSessions(): Promise<void> {
  const remember = Boolean(availableStorage('local')?.getItem(SESSION_TOKEN_KEY));
  const response = await authenticatedFetch('/api/auth/revoke-others', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remember }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token || !data.firebaseToken) {
    throw new Error(data.message || '다른 기기 로그아웃을 처리하지 못했습니다.');
  }
  await signInWithCustomToken(auth, data.firebaseToken);
  availableStorage(remember ? 'local' : 'session')?.setItem(SESSION_TOKEN_KEY, data.token);
}

export async function logoutOwner() {
  clearStoredSession();
  await signOut(auth).catch(() => undefined);
  notifyAuthState();
}
