import { reportStorageFull } from './syncStatus';

/**
 * localStorage writes that survive a full device.
 *
 * `setItem` throws QuotaExceededError once the browser's ~5MB budget is spent.
 * Left unhandled inside a snapshot callback that silently stops one collection
 * from syncing. Writes here first free caches that can be rebuilt, retry once,
 * and otherwise report `storageFull` so the user is told instead of guessing.
 */
export class StorageFullError extends Error {
  constructor(key: string) {
    super(`기기 저장 공간이 부족해 ${key} 데이터를 저장하지 못했습니다.`);
    this.name = 'StorageFullError';
  }
}

export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, code } = error as { name?: string; code?: number };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

type CacheEvictor = () => void;
const evictors = new Set<CacheEvictor>([
  // Crash records are only a diagnostic aid.
  () => localStorage.removeItem('eb_render_errors'),
]);

/** Registers a routine that frees data which can be fetched or computed again. */
export function registerCacheEvictor(evictor: CacheEvictor): () => void {
  evictors.add(evictor);
  return () => {
    evictors.delete(evictor);
  };
}

// Keys whose last write failed. The banner stays until each of them succeeds again.
const failedKeys = new Set<string>();

function markWritten(key: string) {
  if (!failedKeys.delete(key)) return;
  if (failedKeys.size === 0) reportStorageFull(false);
}

function evictAll() {
  evictors.forEach(evict => {
    try {
      evict();
    } catch {
      // Eviction is best effort; the retry below decides whether it helped.
    }
  });
}

/** Returns false (after reporting `storageFull`) when the value could not be stored. */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    markWritten(key);
    return true;
  } catch (error) {
    if (!isQuotaError(error)) throw error;
  }
  evictAll();
  try {
    localStorage.setItem(key, value);
    markWritten(key);
    return true;
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    failedKeys.add(key);
    reportStorageFull(true);
    return false;
  }
}

/** Like {@link safeSetItem} but throws, for data that must not be silently dropped (the outbox). */
export function strictSetItem(key: string, value: string): void {
  if (!safeSetItem(key, value)) throw new StorageFullError(key);
}
