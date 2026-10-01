import type { AmountChangeRecord, Transaction } from '../types';
import type { AmountConflictError } from './amountOperations';
import { getAccountStorageKey } from './auth';
import { describeFirestoreWriteError, stripUndefined } from './firestorePayload';
import { pendingChangesFor, type OverlayEntry } from './outboxOverlay';
import { registerCacheEvictor, safeSetItem, strictSetItem } from './safeStorage';
import { PendingWriteSummary, reportPendingCount, resetSyncStatus } from './syncStatus';

/*
 * Everything about the offline outbox that needs no Firebase code: the queue,
 * parked conflicts, the history floor and the overlay lookup. It stays in the
 * first-screen bundle so a change can be queued the moment it is made, even
 * before the Firestore code (a separate, lazily loaded chunk) has arrived.
 */

export const COLLECTION_APP_SETTINGS = 'appSettings';
export const DOC_GLOBAL_SETTINGS = 'global';
export const COLLECTION_TRANSACTIONS = 'transactions';
export const COLLECTION_CATEGORIES = 'categories';
export const COLLECTION_BUDGETS = 'budgets';
export const COLLECTION_RECURRING_TEMPLATES = 'recurringTemplates';
export const COLLECTION_RECURRING_OCCURRENCES = 'recurringOccurrences';
export const COLLECTION_MERCHANT_RULES = 'merchantRules';
export const COLLECTION_BANK_ACCOUNTS = 'bankAccounts';
export const COLLECTION_PAYMENT_CARDS = 'paymentCards';
export const COLLECTION_CYCLE_BASELINES = 'cycleBaselines';
export const COLLECTION_QUICK_ENTRIES = 'quickEntries';
export const COLLECTION_AMOUNT_CHANGES = 'amountChanges';
export const ACCOUNT_KEYS = {
  get firestoreOutbox() { return getAccountStorageKey('brake_firestore_outbox'); },
  get transactionHistoryFloor() { return getAccountStorageKey('brake_transaction_history_floor'); },
  get syncConflicts() { return getAccountStorageKey('brake_sync_conflicts'); },
};

/** One document touched by a conditional (revision-checked) operation. */
export interface ConditionalDocumentWrite {
  collectionName: string;
  documentId: string;
  /** Omitted for a delete. */
  data?: Record<string, unknown>;
  /** Revision the operation was built on; 0 also means "must not exist". */
  expectedRevision: number;
  remove?: boolean;
}

/** An operation the server refused because a document moved underneath it. */
export interface SyncConflict {
  operationId: string;
  documents: ConditionalDocumentWrite[];
  changeRecord?: AmountChangeRecord;
  queuedAt: string;
  conflictedAt: string;
  message: string;
}

export interface PendingFirestoreWrite {
  id: string;
  operation: 'set' | 'delete' | 'conditional';
  /** For 'conditional' this is the primary document, used for queue de-duplication. */
  collectionName: string;
  documentId: string;
  data?: Record<string, unknown>;
  merge?: boolean;
  /** 'conditional' only: every document in the operation plus its change record. */
  operationId?: string;
  documents?: ConditionalDocumentWrite[];
  changeRecord?: AmountChangeRecord;
  queuedAt: string;
  failedAt?: string;
  lastError?: string;
}

export function readFirestoreOutbox(): PendingFirestoreWrite[] {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEYS.firestoreOutbox);
    return raw ? JSON.parse(raw) as PendingFirestoreWrite[] : [];
  } catch (error) {
    console.error('Failed to read Firestore persistence outbox:', error);
    return [];
  }
}

export function writeFirestoreOutbox(entries: PendingFirestoreWrite[]) {
  if (entries.length === 0) {
    localStorage.removeItem(ACCOUNT_KEYS.firestoreOutbox);
  } else {
    // Throws when the device is full: an outbox entry that was not stored is a lost change.
    strictSetItem(ACCOUNT_KEYS.firestoreOutbox, JSON.stringify(entries));
  }
  reportPendingCount(entries.length);
}

/** Human-readable label for the pending-changes screen. */
const COLLECTION_LABELS: Record<string, string> = {
  transactions: '거래',
  categories: '카테고리',
  budgets: '용돈 한도',
  recurringTemplates: '정기 항목',
  recurringOccurrences: '정기 발생 건',
  merchantRules: '분류 규칙',
  bankAccounts: '계좌',
  paymentCards: '카드',
  cycleBaselines: '주기 생활비 계획',
  quickEntries: '퀵등록',
  appSettings: '앱 설정',
  amountChanges: '금액 변경 이력',
};

function readSyncConflicts(): SyncConflict[] {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEYS.syncConflicts);
    return raw ? JSON.parse(raw) as SyncConflict[] : [];
  } catch {
    return [];
  }
}

function writeSyncConflicts(conflicts: SyncConflict[]) {
  if (conflicts.length === 0) localStorage.removeItem(ACCOUNT_KEYS.syncConflicts);
  else safeSetItem(ACCOUNT_KEYS.syncConflicts, JSON.stringify(conflicts));
  conflictListeners.forEach(listener => listener());
}

const conflictListeners = new Set<() => void>();

/** Conflicts are kept for review, never retried blindly (PRD §8 "비교 후 적용"). */
export function getSyncConflicts(): SyncConflict[] {
  return readSyncConflicts();
}

export function dismissSyncConflict(operationId: string) {
  writeSyncConflicts(readSyncConflicts().filter(conflict => conflict.operationId !== operationId));
}

export function subscribeSyncConflicts(listener: () => void): () => void {
  conflictListeners.add(listener);
  return () => { conflictListeners.delete(listener); };
}

export function recordSyncConflict(entry: PendingFirestoreWrite, error: AmountConflictError) {
  const conflict: SyncConflict = {
    operationId: entry.operationId || entry.id,
    documents: entry.documents || [],
    changeRecord: entry.changeRecord,
    queuedAt: entry.queuedAt,
    conflictedAt: new Date().toISOString(),
    message: error.message,
  };
  writeSyncConflicts([...readSyncConflicts().filter(item => item.operationId !== conflict.operationId), conflict]);
}

export function describePendingCollection(collectionName: string): string {
  return COLLECTION_LABELS[collectionName] || collectionName;
}

export function getPendingFirestoreWrites(): PendingWriteSummary[] {
  return readFirestoreOutbox()
    .map(({ id, operation, collectionName, documentId, queuedAt, failedAt, lastError }) => ({
      id,
      operation,
      collectionName,
      documentId,
      queuedAt,
      failedAt,
      lastError,
    }))
    .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
}

export function enqueueFirestoreWrite(entry: Omit<PendingFirestoreWrite, 'id' | 'queuedAt'>): PendingFirestoreWrite {
  const queued: PendingFirestoreWrite = {
    ...stripUndefined(entry),
    id: `write_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    queuedAt: new Date().toISOString(),
  };
  // Only the latest pending plain write for one document matters. This also
  // collapses queues produced by older clients that retried the same write.
  // Conditional operations are never collapsed: each one is based on the
  // revision the previous one produces, so they must all reach the server in order.
  const pending = readFirestoreOutbox().filter(candidate => queued.operation === 'conditional'
    || candidate.operation === 'conditional'
    || !(candidate.collectionName === queued.collectionName && candidate.documentId === queued.documentId));
  writeFirestoreOutbox([...pending, queued]);
  return queued;
}

export function removeFirestoreWrite(id: string) {
  writeFirestoreOutbox(readFirestoreOutbox().filter(entry => entry.id !== id));
}

export function recordFirestoreWriteError(id: string, error: unknown): string {
  const message = describeFirestoreWriteError(error);
  const failedAt = new Date().toISOString();
  writeFirestoreOutbox(readFirestoreOutbox().map(entry => (
    entry.id === id ? { ...entry, failedAt, lastError: message } : entry
  )));
  return message;
}


const transactionsKey = () => getAccountStorageKey('brake_transactions');

function readCachedTransactions(): Transaction[] {
  try {
    const raw = localStorage.getItem(transactionsKey());
    return raw ? JSON.parse(raw) as Transaction[] : [];
  } catch {
    return [];
  }
}

/**
 * Oldest `localDate` currently present in the local transaction cache. Anything
 * before this has to be fetched before a screen can summarise it truthfully.
 */
let liveTransactionWindowStart = '';

export const getLiveTransactionWindowStart = () => liveTransactionWindowStart;
export function setLiveTransactionWindowStart(value: string) {
  liveTransactionWindowStart = value;
}

export function readHistoryFloor(fallback: string): string {
  const stored = localStorage.getItem(ACCOUNT_KEYS.transactionHistoryFloor);
  return stored && stored < fallback ? stored : fallback;
}

/** The earliest date the local transaction cache can be trusted to be complete from. */
export function getLoadedTransactionHistoryFloor(): string {
  return readHistoryFloor(liveTransactionWindowStart);
}

/** Publishes the outbox length that already exists in this browser at boot. */
export function syncPendingCountFromStorage() {
  reportPendingCount(readFirestoreOutbox().length);
}

export function clearTransactionHistoryFloor() {
  localStorage.removeItem(ACCOUNT_KEYS.transactionHistoryFloor);
  setLiveTransactionWindowStart('');
}

export function clearFirestoreOutbox() {
  localStorage.removeItem(ACCOUNT_KEYS.firestoreOutbox);
  localStorage.removeItem(ACCOUNT_KEYS.syncConflicts);
  resetSyncStatus();
}

export const AMOUNT_CHANGES_COLLECTION = COLLECTION_AMOUNT_CHANGES;
export const TRANSACTIONS_COLLECTION = COLLECTION_TRANSACTIONS;
export const RECURRING_OCCURRENCES_COLLECTION = COLLECTION_RECURRING_OCCURRENCES;

/** What the outbox still owes the server for one collection, to be laid over a snapshot. */
export function pendingChanges(collectionName: string) {
  return pendingChangesFor(collectionName, readFirestoreOutbox() as OverlayEntry[]);
}

/**
 * Frees what can be fetched again when the device is out of space: the AI
 * report cache, and cached transaction history older than the live window
 * (the history floor moves up so the older periods are re-fetched on demand).
 */
registerCacheEvictor(() => {
  localStorage.removeItem(getAccountStorageKey('brake_ai_insights'));
  const windowStart = getLiveTransactionWindowStart();
  if (!windowStart) return;
  const cached = readCachedTransactions();
  const recent = cached.filter(transaction => transaction.localDate >= windowStart);
  if (recent.length === cached.length) return;
  localStorage.setItem(transactionsKey(), JSON.stringify(recent));
  localStorage.setItem(ACCOUNT_KEYS.transactionHistoryFloor, windowStart);
});

