import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSyncState,
  registerOutboxFlusher,
  reportPendingCount,
  reportWriteFailed,
  reportWriteStarted,
  reportWriteSucceeded,
  resetSyncStatus,
  retryPendingWrites,
  subscribeToSyncStatus,
} from './syncStatus';

describe('syncStatus', () => {
  beforeEach(() => {
    resetSyncStatus();
  });

  it('reports synced when nothing is queued or in flight', () => {
    expect(getSyncState().phase).toBe('synced');
    expect(getSyncState().pendingCount).toBe(0);
  });

  it('reports syncing while a write is in flight', () => {
    reportPendingCount(1);
    reportWriteStarted();
    expect(getSyncState().phase).toBe('syncing');

    reportWriteSucceeded();
    reportPendingCount(0);
    expect(getSyncState().phase).toBe('synced');
    expect(getSyncState().lastSyncedAt).not.toBeNull();
  });

  it('keeps a pending phase and the error message when a write fails', () => {
    reportPendingCount(2);
    reportWriteStarted();
    reportWriteFailed('거래를 저장하지 못했습니다.');

    const state = getSyncState();
    expect(state.phase).toBe('pending');
    expect(state.pendingCount).toBe(2);
    expect(state.lastError).toBe('거래를 저장하지 못했습니다.');
  });

  it('notifies subscribers immediately and on every change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSyncStatus(listener);
    expect(listener).toHaveBeenCalledTimes(1);

    reportPendingCount(3);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ pendingCount: 3 }));

    unsubscribe();
    reportPendingCount(4);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('clears the last error when a retry is requested', async () => {
    const flusher = vi.fn().mockResolvedValue(true);
    registerOutboxFlusher(flusher);

    reportPendingCount(1);
    reportWriteStarted();
    reportWriteFailed('네트워크 오류');
    expect(getSyncState().lastError).toBe('네트워크 오류');

    await expect(retryPendingWrites()).resolves.toBe(true);
    expect(flusher).toHaveBeenCalledTimes(1);
    expect(getSyncState().lastError).toBeNull();
  });
});
