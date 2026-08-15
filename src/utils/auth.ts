import { apiUrl } from './api';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';

const SESSION_TOKEN_KEY = 'eb_session_token';
const SESSION_ACCOUNT_KEY = 'eb_session_account';

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

function notifyAuthState() {
  const loggedIn = isOwnerLoggedIn();
  listeners.forEach(fn => fn(loggedIn));
}

export function isOwnerLoggedIn(): boolean {
  return Boolean(sessionStorage.getItem(SESSION_TOKEN_KEY));
}

export function getSignedInAccount(): SignedInAccount {
  try {
    const raw = sessionStorage.getItem(SESSION_ACCOUNT_KEY);
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

export async function loginWithPin(pin: string) {
  const response = await fetch(apiUrl('/api/auth/verify-key'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: pin }),
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
  sessionStorage.setItem(SESSION_TOKEN_KEY, data.token);
  sessionStorage.setItem(SESSION_ACCOUNT_KEY, JSON.stringify(account));
  notifyAuthState();
  return account;
}

export async function getOwnerIdToken() {
  const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
  if (!token) throw new Error('PIN 로그인이 필요합니다.');
  return token;
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = await getOwnerIdToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const target = typeof input === 'string' && input.startsWith('/') ? apiUrl(input) : input;
  return fetch(target, { ...init, headers });
}

export async function logoutOwner() {
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  sessionStorage.removeItem(SESSION_ACCOUNT_KEY);
  await signOut(auth).catch(() => undefined);
  notifyAuthState();
}
