import type { UserProfile } from '../types';

/** Firestore rejects undefined values, including values nested in objects/arrays. */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter(item => item !== undefined)
      .map(item => stripUndefined(item)) as T;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)]),
    ) as T;
  }
  return value;
}

/** The legacy PIN must never be written back to the client-readable profile. */
export function sanitizeUserProfileForFirestore(
  profile: UserProfile | Record<string, unknown>,
): Record<string, unknown> {
  const { accessPin: _legacyPin, ...safeProfile } = profile;
  return stripUndefined(safeProfile);
}

/** Safe, actionable text for the local pending-write screen. */
export function describeFirestoreWriteError(error: unknown): string {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = String(candidate?.code || '').toLowerCase();
  if (code.includes('permission-denied')) {
    return 'DB 권한이 거부되었습니다. 앱 설정의 이전 보안 필드를 정리한 뒤 다시 저장합니다.';
  }
  if (code.includes('unauthenticated')) return '로그인 인증이 만료되었습니다. 앱을 잠갔다가 다시 로그인해 주세요.';
  if (code.includes('unavailable') || code.includes('network')) return 'DB에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.';
  if (code.includes('resource-exhausted')) return 'DB 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
  if (code.includes('invalid-argument') || code.includes('failed-precondition')) {
    return '저장 데이터 형식이 현재 DB 설정과 맞지 않습니다. 앱을 최신 버전으로 업데이트해 주세요.';
  }
  return 'DB 저장 중 알 수 없는 오류가 발생했습니다. 앱을 다시 연 뒤 재시도해 주세요.';
}
