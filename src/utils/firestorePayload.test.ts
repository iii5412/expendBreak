import { describe, expect, it } from 'vitest';
import { stripUndefined } from './firestorePayload';

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
