/**
 * Tracks whether local changes have actually reached Firestore.
 *
 * Writes are local-first: the UI updates immediately and the Firestore write is
 * queued in the persistence outbox. Without this module a failed write is
 * invisible until the next login, so every screen can subscribe here to show
 * pending/offline state and offer a retry.
 */

export type SyncPhase = 'synced' | 'syncing' | 'pending' | 'offline';

export interface PendingWriteSummary {
  id: string;
  operation: 'set' | 'delete';
  collectionName: string;
  documentId: string;
  queuedAt: string;
}

export interface SyncState {
  phase: SyncPhase;
  pendingCount: number;
  isOnline: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

type SyncListener = (state: SyncState) => void;

const listeners = new Set<SyncListener>();

let pendingCount = 0;
let inFlightCount = 0;
let isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
let lastSyncedAt: string | null = null;
let lastError: string | null = null;
let outboxFlusher: (() => Promise<boolean>) | null = null;

function derivePhase(): SyncPhase {
  if (!isOnline && pendingCount > 0) return 'offline';
  if (inFlightCount > 0) return 'syncing';
  if (pendingCount > 0) return 'pending';
  return 'synced';
}

export function getSyncState(): SyncState {
  return {
    phase: derivePhase(),
    pendingCount,
    isOnline,
    lastSyncedAt,
    lastError,
  };
}

function notify() {
  const snapshot = getSyncState();
  listeners.forEach(listener => listener(snapshot));
}

export function subscribeToSyncStatus(listener: SyncListener): () => void {
  listeners.add(listener);
  listener(getSyncState());
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the persistence layer whenever the outbox length changes. */
export function reportPendingCount(count: number) {
  if (pendingCount === count) return;
  pendingCount = Math.max(0, count);
  notify();
}

export function reportWriteStarted() {
  inFlightCount += 1;
  notify();
}

export function reportWriteSucceeded() {
  inFlightCount = Math.max(0, inFlightCount - 1);
  lastSyncedAt = new Date().toISOString();
  lastError = null;
  notify();
}

export function reportWriteFailed(message: string) {
  inFlightCount = Math.max(0, inFlightCount - 1);
  lastError = message;
  notify();
}

export function clearSyncError() {
  if (lastError === null) return;
  lastError = null;
  notify();
}

export function resetSyncStatus() {
  pendingCount = 0;
  inFlightCount = 0;
  lastError = null;
  lastSyncedAt = null;
  notify();
}

/**
 * The persistence layer registers its flush routine here so reconnect handling
 * lives in one place without creating an import cycle.
 */
export function registerOutboxFlusher(flusher: () => Promise<boolean>) {
  outboxFlusher = flusher;
}

export function retryPendingWrites(): Promise<boolean> {
  if (!outboxFlusher) return Promise.resolve(true);
  clearSyncError();
  return outboxFlusher();
}

function handleOnline() {
  isOnline = true;
  notify();
  if (pendingCount > 0) void retryPendingWrites();
}

function handleOffline() {
  isOnline = false;
  notify();
}

export function startNetworkWatch(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  isOnline = navigator.onLine !== false;
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  notify();
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
