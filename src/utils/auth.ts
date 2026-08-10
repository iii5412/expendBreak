const SESSION_TOKEN_KEY = 'eb_session_token';

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

export async function loginWithPin(pin: string) {
  const response = await fetch('/api/auth/verify-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: pin }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.token) {
    const error = new Error(
      response.status === 429
        ? 'PIN 입력이 잠시 제한되었습니다.'
        : data.message || data.error || 'PIN이 일치하지 않습니다.',
    ) as PinLoginError;
    error.status = response.status;
    error.retryAfterMs = Number(data.retryAfterMs || 0);
    throw error;
  }

  sessionStorage.setItem(SESSION_TOKEN_KEY, data.token);
  notifyAuthState();
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
  return fetch(input, { ...init, headers });
}

export async function logoutOwner() {
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  notifyAuthState();
}
