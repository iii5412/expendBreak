import { describe, expect, it } from 'vitest';
import { describeFirestoreWriteError, sanitizeUserProfileForFirestore, stripUndefined } from './firestorePayload';

describe('stripUndefined', () => {
  it('removes undefined fields recursively before a Firestore write', () => {
    expect(stripUndefined({
      id: 'occurrence',
      accountId: undefined,
      nested: { cardId: undefined, amount: 10_000 },
      values: [1, undefined, { optional: undefined, kept: true }],
    })).toEqual({
      id: 'occurrence',
      nested: { amount: 10_000 },
      values: [1, { kept: true }],
    });
  });
});

describe('Firestore profile compatibility', () => {
  it('removes a legacy access PIN before replacing appSettings/global', () => {
    expect(sanitizeUserProfileForFirestore({
      uid: 'owner',
      displayName: '사용자',
      accessPin: 'legacy-secret',
      optional: undefined,
    })).toEqual({ uid: 'owner', displayName: '사용자' });
  });

  it('turns Firebase error codes into actionable user-facing causes', () => {
    expect(describeFirestoreWriteError({ code: 'firestore/permission-denied' })).toContain('권한');
    expect(describeFirestoreWriteError({ code: 'auth/unauthenticated' })).toContain('로그인');
    expect(describeFirestoreWriteError({ code: 'firestore/unavailable' })).toContain('인터넷');
  });
});
