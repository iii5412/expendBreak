import {
  browserSessionPersistence,
  setPersistence,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

export interface PinLoginError extends Error {
  status?: number;
  retryAfterMs?: number;
}

export async function loginWithPin(pin: string) {
  const response = await fetch('/api/auth/verify-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: pin }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.customToken) {
    const error = new Error(
      response.status === 429
        ? 'PIN 입력이 잠시 제한되었습니다.'
        : data.message || data.error || 'PIN이 일치하지 않습니다.',
    ) as PinLoginError;
    error.status = response.status;
    error.retryAfterMs = Number(data.retryAfterMs || 0);
    throw error;
  }

  await setPersistence(auth, browserSessionPersistence);
  await signInWithCustomToken(auth, data.customToken);
}

export async function getOwnerIdToken() {
  const user = auth.currentUser;
  if (!user) throw new Error('PIN 로그인이 필요합니다.');
  return user.getIdToken();
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = await getOwnerIdToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export async function logoutOwner() {
  await signOut(auth);
}
