import { describe, expect, it, vi } from 'vitest';
import { createMemorySessionEpochStore, createSessionEpochs, SESSION_EPOCH_CACHE_MS } from './sessionEpochs';

describe('session epochs', () => {
  it('defaults to 0 and raises the epoch on revoke', async () => {
    const epochs = createSessionEpochs({ store: createMemorySessionEpochStore() });
    expect(await epochs.current('owner')).toBe(0);
    expect(await epochs.revoke('owner')).toBe(1);
    expect(await epochs.current('owner')).toBe(1);
  });

  it('caches reads for 60 seconds', async () => {
    let clock = 0;
    const store = createMemorySessionEpochStore();
    const read = vi.spyOn(store, 'read');
    const epochs = createSessionEpochs({ store, now: () => clock });

    await epochs.current('owner');
    // Another instance (the revoke script) raises the epoch behind this cache.
    await store.increment('owner');
    clock = SESSION_EPOCH_CACHE_MS - 1;
    expect(await epochs.current('owner')).toBe(0);
    clock = SESSION_EPOCH_CACHE_MS;
    expect(await epochs.current('owner')).toBe(1);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads fresh values when issuing a token', async () => {
    const store = createMemorySessionEpochStore();
    const epochs = createSessionEpochs({ store });
    await epochs.current('owner');
    await store.increment('owner');
    expect(await epochs.fresh('owner')).toBe(1);
  });

  it('uses a stale cached epoch while the store is down, and throws without one', async () => {
    let clock = 0;
    const store = createMemorySessionEpochStore({ owner: 2 });
    const epochs = createSessionEpochs({ store, now: () => clock, log: () => undefined });
    await epochs.current('owner');

    vi.spyOn(store, 'read').mockRejectedValue(new Error('firestore down'));
    clock = SESSION_EPOCH_CACHE_MS * 5;
    expect(await epochs.current('owner')).toBe(2);
    await expect(epochs.current('wife')).rejects.toThrow('firestore down');
  });
});
