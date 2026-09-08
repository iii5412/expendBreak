import type { Firestore } from 'firebase-admin/firestore';

export class AccountMergeError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const REFERENCES = [
  ['paymentCards', 'linkedAccountId'],
  ['recurringTemplates', 'accountId'],
  ['recurringOccurrences', 'accountId'],
  ['transactions', 'accountId'],
  ['quickEntries', 'accountId'],
] as const;

// One transaction also writes the deletion and idempotency receipt. Keep the
// total below Firestore's 500-write transaction limit.
const MAX_REFERENCE_WRITES = 498;

export function validateAccountMergeIds(sourceId: unknown, targetId: unknown): asserts sourceId is string {
  const valid = (id: unknown) => typeof id === 'string' && id.trim().length > 0
    && id.length <= 200 && !id.includes('/') && id !== '.' && id !== '..';
  if (!valid(sourceId) || !valid(targetId)) throw new AccountMergeError('삭제할 계좌와 남길 계좌를 선택해 주세요.');
  if (sourceId === targetId) throw new AccountMergeError('삭제할 계좌와 다른 계좌를 선택해 주세요.');
}

/** Server-side queries cover all history, not only the client's current cache.
 * All reference patches and source deletion commit together, or none do.
 * The receipt makes a retry safe if the first response was lost after commit. */
export async function mergeBankAccountRecords(db: Firestore, userUid: string, sourceId: string, targetId: string) {
  validateAccountMergeIds(sourceId, targetId);
  const user = db.collection('users').doc(userUid);
  const source = user.collection('bankAccounts').doc(sourceId);
  const target = user.collection('bankAccounts').doc(targetId);
  const receipt = user.collection('accountMerges').doc(sourceId);

  return db.runTransaction(async transaction => {
    const [sourceSnapshot, targetSnapshot, receiptSnapshot] = await transaction.getAll(source, target, receipt);
    if (receiptSnapshot.exists) {
      const previous = receiptSnapshot.data()!;
      if (previous.targetId !== targetId) throw new AccountMergeError('이미 다른 계좌로 정리된 계좌입니다. 계좌 목록을 새로 확인해 주세요.', 409);
      if (sourceSnapshot.exists) throw new AccountMergeError('정리된 계좌가 다시 생성되었습니다. 계좌 목록을 확인해 주세요.', 409);
      return { sourceId, targetId, total: previous.total as number, counts: previous.counts as Record<string, number>, updatedAt: previous.updatedAt as string };
    }
    if (!sourceSnapshot.exists || !targetSnapshot.exists) throw new AccountMergeError('삭제할 계좌 또는 남길 계좌를 찾을 수 없습니다. 계좌 목록을 새로 확인해 주세요.', 409);

    // Read every query before issuing writes, as required by Firestore transactions.
    const snapshots = await Promise.all(REFERENCES.map(([collection, field]) =>
      transaction.get(user.collection(collection).where(field, '==', sourceId))));
    const referenceCount = snapshots.reduce((sum, snapshot) => sum + snapshot.size, 0);
    if (referenceCount > MAX_REFERENCE_WRITES) {
      throw new AccountMergeError(
        `연결 내역이 ${referenceCount}건이라 한 번에 변경할 수 없습니다. 데이터 관리자에게 문의해 주세요.`,
        409,
      );
    }
    const updatedAt = new Date().toISOString();
    const counts: Record<string, number> = {};
    snapshots.forEach((snapshot, index) => {
      const [collection, field] = REFERENCES[index];
      counts[collection] = snapshot.size;
      snapshot.docs.forEach(document => transaction.update(document.ref, { [field]: targetId, updatedAt }));
    });
    const result = { sourceId, targetId, total: referenceCount, counts, updatedAt };
    transaction.delete(source);
    transaction.set(receipt, result);
    return result;
  });
}
