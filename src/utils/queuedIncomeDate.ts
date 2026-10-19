import { AmountConflictError } from './amountOperations';
import type { PendingFirestoreWrite } from './firestoreOutbox';

const validDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function isQueuedIncomeDateCandidate(entry: PendingFirestoreWrite) {
  return (
    entry.operation === 'set' &&
    !entry.merge &&
    entry.collectionName === 'transactions' &&
    entry.data?.type === 'income' &&
    Number.isSafeInteger(entry.data.revision) &&
    Number(entry.data.revision) > 0 &&
    validDate(entry.data.localDate) &&
    !entry.data.receipt &&
    !entry.data.voiceRecord
  );
}

function comparable(data: Record<string, unknown>) {
  const {
    updatedAt: _time,
    revision: _revision,
    lastOperationId: _operation,
    localDate: _date,
    occurredAt: _instant,
    id: _id,
    ...rest
  } = data;
  const defaults = { merchant: '', memo: '', role: 'normal', isOneOff: false, paymentMethodType: 'other', tags: [] };
  const normalized: Record<string, unknown> = { ...rest };
  for (const [key, fallback] of Object.entries(defaults)) normalized[key] ??= fallback;
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, v]) => v != null)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, stable(v)]),
          )
        : value;
  return JSON.stringify(stable(normalized));
}

/** Only restore the user's rejected date edit. Never rebase amounts or newer server edits. */
export function queuedIncomeDateRetry(entry: PendingFirestoreWrite, current: Record<string, unknown> | null) {
  const queued = entry.data!;
  const operationId = `date_retry_${entry.id}`;
  const conflict = () =>
    new AmountConflictError(
      '날짜 변경 대기 건을 자동으로 반영하지 못했습니다. 내역에서 최신 기록과 변경 내용을 확인해 주세요.',
    );
  if (!current || !isQueuedIncomeDateCandidate(entry)) throw conflict();
  if (current.lastOperationId === operationId && current.localDate === queued.localDate)
    return { data: current, changed: false };
  if (current.revision !== queued.revision || comparable(current) !== comparable(queued)) throw conflict();
  if (current.localDate === queued.localDate) throw conflict(); // The rejection has a different cause.
  if (
    typeof queued.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(queued.occurredAt)) ||
    !queued.occurredAt.startsWith(`${queued.localDate}T`)
  )
    throw conflict();
  return {
    changed: true,
    data: {
      ...current,
      localDate: queued.localDate,
      occurredAt: queued.occurredAt,
      revision: Number(current.revision) + 1,
      lastOperationId: operationId,
      updatedAt: new Date().toISOString(),
    },
  };
}
