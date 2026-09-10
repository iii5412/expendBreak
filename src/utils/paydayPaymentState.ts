import { getAccountStorageKey } from './auth';

export interface PaydayFundingRecord {
  yearMonth: string;
  groupKey: string;
  amount: number;
  preparedAt: string;
}

export interface PaydayPaymentBatch {
  id: string;
  yearMonth: string;
  groupKey: string;
  itemIds: string[];
  paidAt: string;
  undoneAt?: string | null;
}

const FUNDING_KEY = 'expendbreak_payday_funding_v1';
const BATCH_KEY = 'expendbreak_payday_payment_batches_v1';

const scopedKey = (key: string) => getAccountStorageKey(key);

function readObject<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function fundingId(yearMonth: string, groupKey: string) {
  return `${yearMonth}::${groupKey}`;
}

export function getPaydayFunding(yearMonth: string, groupKey: string): PaydayFundingRecord | null {
  return readObject<Record<string, PaydayFundingRecord>>(scopedKey(FUNDING_KEY), {})[fundingId(yearMonth, groupKey)] || null;
}

export function savePaydayFunding(yearMonth: string, groupKey: string, amount: number): PaydayFundingRecord {
  const key = scopedKey(FUNDING_KEY);
  const records = readObject<Record<string, PaydayFundingRecord>>(key, {});
  const record: PaydayFundingRecord = {
    yearMonth,
    groupKey,
    amount: Math.max(0, Math.round(amount)),
    preparedAt: new Date().toISOString(),
  };
  records[fundingId(yearMonth, groupKey)] = record;
  localStorage.setItem(key, JSON.stringify(records));
  return record;
}

export function clearPaydayFunding(yearMonth: string, groupKey: string) {
  const key = scopedKey(FUNDING_KEY);
  const records = readObject<Record<string, PaydayFundingRecord>>(key, {});
  delete records[fundingId(yearMonth, groupKey)];
  localStorage.setItem(key, JSON.stringify(records));
}

export function savePaydayPaymentBatch(yearMonth: string, groupKey: string, itemIds: string[]) {
  if (itemIds.length === 0) return null;
  const key = scopedKey(BATCH_KEY);
  const batches = readObject<PaydayPaymentBatch[]>(key, []);
  const paidAt = new Date().toISOString();
  const batch: PaydayPaymentBatch = {
    id: `payday_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    yearMonth,
    groupKey,
    itemIds: [...new Set(itemIds)],
    paidAt,
  };
  batches.unshift(batch);
  localStorage.setItem(key, JSON.stringify(batches.slice(0, 120)));
  return batch;
}

export function getLatestPaydayPaymentBatch(yearMonth: string, groupKey: string) {
  return readObject<PaydayPaymentBatch[]>(scopedKey(BATCH_KEY), [])
    .find(batch => batch.yearMonth === yearMonth && batch.groupKey === groupKey && !batch.undoneAt) || null;
}

export function markPaydayPaymentBatchUndone(batchId: string) {
  const key = scopedKey(BATCH_KEY);
  const batches = readObject<PaydayPaymentBatch[]>(key, []);
  const batch = batches.find(candidate => candidate.id === batchId);
  if (!batch) return false;
  batch.undoneAt = new Date().toISOString();
  localStorage.setItem(key, JSON.stringify(batches));
  return true;
}

export function clearPaydayPaymentState() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(scopedKey(FUNDING_KEY));
  localStorage.removeItem(scopedKey(BATCH_KEY));
}
