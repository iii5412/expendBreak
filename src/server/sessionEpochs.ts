import type { Firestore } from 'firebase-admin/firestore';

/**
 * Each account has a session generation ("epoch"). Tokens carry the epoch they
 * were issued under, and raising it revokes every older token at once. The
 * documents live in `sessionEpochs/{uid}`, which client security rules deny.
 */
export interface SessionEpochStore {
  read(uid: string): Promise<number>;
  /** Raises the epoch by one and returns the new value. */
  increment(uid: string): Promise<number>;
}

export const SESSION_EPOCH_CACHE_MS = 60_000;

const toEpoch = (value: unknown) => {
  const epoch = Number(value);
  return Number.isSafeInteger(epoch) && epoch > 0 ? epoch : 0;
};

export function createMemorySessionEpochStore(initial: Record<string, number> = {}): SessionEpochStore {
  const epochs = new Map(Object.entries(initial));
  return {
    async read(uid) {
      return epochs.get(uid) ?? 0;
    },
    async increment(uid) {
      const next = (epochs.get(uid) ?? 0) + 1;
      epochs.set(uid, next);
      return next;
    },
  };
}

export function createFirestoreSessionEpochStore(db: Firestore): SessionEpochStore {
  const reference = (uid: string) => db.collection('sessionEpochs').doc(uid);
  return {
    async read(uid) {
      const snapshot = await reference(uid).get();
      return toEpoch(snapshot.exists ? snapshot.get('epoch') : 0);
    },
    increment: uid => db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference(uid));
      const next = toEpoch(snapshot.exists ? snapshot.get('epoch') : 0) + 1;
      transaction.set(reference(uid), { epoch: next, revokedAt: new Date().toISOString() }, { merge: true });
      return next;
    }),
  };
}

/**
 * Reads epochs through a short cache so every API call does not hit Firestore.
 * Another instance may therefore honour a revoked token for up to one cache
 * period. When the store is unreachable a stale cached value is used; with no
 * cached value the read throws and the caller answers 503 rather than guessing.
 */
export function createSessionEpochs({
  store,
  cacheMs = SESSION_EPOCH_CACHE_MS,
  now = Date.now,
  log = console.error,
}: {
  store: SessionEpochStore;
  cacheMs?: number;
  now?: () => number;
  log?: (...messages: unknown[]) => void;
}) {
  const cache = new Map<string, { epoch: number; readAt: number }>();

  async function refresh(uid: string) {
    const epoch = await store.read(uid);
    cache.set(uid, { epoch, readAt: now() });
    return epoch;
  }

  return {
    async current(uid: string): Promise<number> {
      const cached = cache.get(uid);
      if (cached && now() - cached.readAt < cacheMs) return cached.epoch;
      try {
        return await refresh(uid);
      } catch (error) {
        if (!cached) throw error;
        log('Session epoch store unavailable; using the cached epoch:', error instanceof Error ? error.message : error);
        return cached.epoch;
      }
    },

    /** Uncached read, used when issuing a token so it never carries a stale epoch. */
    fresh: refresh,

    async revoke(uid: string): Promise<number> {
      const epoch = await store.increment(uid);
      cache.set(uid, { epoch, readAt: now() });
      return epoch;
    },
  };
}

export type SessionEpochs = ReturnType<typeof createSessionEpochs>;
