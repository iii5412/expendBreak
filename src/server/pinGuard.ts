import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * A PIN identifies an account, so brute force targets the whole deployment
 * rather than one user. Failures are therefore limited per client IP and
 * across the deployment, and the counters live in Firestore so restarts and
 * extra instances do not reset them.
 */
export const PIN_GUARD_LIMITS = {
  ipWindowMs: 10 * 60_000,
  ipFreeFailures: 4,
  ipBaseDelayMs: 1_000,
  ipMaxDelayMs: 15 * 60_000,
  globalWindowMs: 60 * 60_000,
  globalMaxFailures: 30,
  globalLockMs: 15 * 60_000,
} as const;

type IpEntry = { failures: number; lastFailureAt: number; blockedUntil: number };
export type PinGuardState = {
  ips: Record<string, IpEntry>;
  global: { failures: number[]; lockedUntil: number };
};

export interface PinGuardStore {
  transact<T>(update: (state: PinGuardState) => { state: PinGuardState; result: T }): Promise<T>;
}

export type PinGuardCheck =
  | { allowed: true }
  | { allowed: false; scope: 'ip' | 'global'; retryAfterMs: number };

const emptyState = (): PinGuardState => ({ ips: {}, global: { failures: [], lockedUntil: 0 } });

function normalizeState(raw: unknown): PinGuardState {
  const value = raw as Partial<PinGuardState> | undefined;
  return {
    ips: value?.ips && typeof value.ips === 'object' ? { ...value.ips } : {},
    global: {
      failures: Array.isArray(value?.global?.failures) ? value!.global!.failures.filter(Number.isFinite) : [],
      lockedUntil: Number(value?.global?.lockedUntil) || 0,
    },
  };
}

/** Drops expired entries so the shared document stays small. */
function prune(state: PinGuardState, now: number): PinGuardState {
  const ips = Object.fromEntries(Object.entries(state.ips).filter(([, entry]) => (
    now - entry.lastFailureAt < PIN_GUARD_LIMITS.ipWindowMs || entry.blockedUntil > now
  )));
  return {
    ips,
    global: {
      failures: state.global.failures.filter(at => now - at < PIN_GUARD_LIMITS.globalWindowMs),
      lockedUntil: state.global.lockedUntil > now ? state.global.lockedUntil : 0,
    },
  };
}

// Raw client addresses are personal data and never need to be stored.
const ipKey = (ip: string) => createHash('sha256').update(ip).digest('hex').slice(0, 24);

function ipDelayMs(failures: number) {
  if (failures <= PIN_GUARD_LIMITS.ipFreeFailures) return 0;
  const exponent = failures - PIN_GUARD_LIMITS.ipFreeFailures - 1;
  return Math.min(PIN_GUARD_LIMITS.ipMaxDelayMs, PIN_GUARD_LIMITS.ipBaseDelayMs * 2 ** exponent);
}

export function createMemoryPinGuardStore(): PinGuardStore & { peek(): PinGuardState } {
  let state = emptyState();
  return {
    async transact(update) {
      const next = update(structuredClone(state));
      state = next.state;
      return next.result;
    },
    peek: () => structuredClone(state),
  };
}

export function createFirestorePinGuardStore(db: Firestore): PinGuardStore {
  const reference = db.collection('system').doc('pinGuard');
  return {
    transact: update => db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const next = update(normalizeState(snapshot.exists ? snapshot.data() : undefined));
      transaction.set(reference, next.state);
      return next.result;
    }),
  };
}

export function createPinGuard({
  store,
  now = Date.now,
  onGlobalLock = () => undefined,
  log = console.error,
}: {
  store: PinGuardStore;
  now?: () => number;
  onGlobalLock?: (info: { failures: number; lockedUntil: number }) => void;
  log?: (...messages: unknown[]) => void;
}) {
  // Used only while the shared store is unreachable, so an outage never fails open.
  const fallback = createMemoryPinGuardStore();

  async function transact<T>(update: (state: PinGuardState, at: number) => { state: PinGuardState; result: T }) {
    const at = now();
    const run = (state: PinGuardState) => update(prune(state, at), at);
    try {
      return await store.transact(run);
    } catch (error) {
      log('PIN guard store unavailable; using in-memory counters:', error instanceof Error ? error.message : error);
      return fallback.transact(run);
    }
  }

  return {
    check(ip: string): Promise<PinGuardCheck> {
      return transact((state, at) => {
        let result: PinGuardCheck = { allowed: true };
        const entry = state.ips[ipKey(ip)];
        if (state.global.lockedUntil > at) {
          result = { allowed: false, scope: 'global', retryAfterMs: state.global.lockedUntil - at };
        } else if (entry && entry.blockedUntil > at) {
          result = { allowed: false, scope: 'ip', retryAfterMs: entry.blockedUntil - at };
        }
        return { state, result };
      });
    },

    async recordFailure(ip: string): Promise<{ retryAfterMs: number }> {
      const outcome = await transact((state, at) => {
        const key = ipKey(ip);
        const failures = (state.ips[key]?.failures || 0) + 1;
        const delayMs = ipDelayMs(failures);
        state.ips[key] = { failures, lastFailureAt: at, blockedUntil: at + delayMs };
        state.global.failures.push(at);

        let lockEngaged = false;
        if (state.global.failures.length >= PIN_GUARD_LIMITS.globalMaxFailures && state.global.lockedUntil <= at) {
          state.global.lockedUntil = at + PIN_GUARD_LIMITS.globalLockMs;
          lockEngaged = true;
        }
        const globalWaitMs = Math.max(0, state.global.lockedUntil - at);
        return {
          state,
          result: {
            retryAfterMs: Math.max(delayMs, globalWaitMs),
            lockEngaged,
            failures: state.global.failures.length,
            lockedUntil: state.global.lockedUntil,
          },
        };
      });
      if (outcome.lockEngaged) onGlobalLock({ failures: outcome.failures, lockedUntil: outcome.lockedUntil });
      return { retryAfterMs: outcome.retryAfterMs };
    },

    async recordSuccess(ip: string): Promise<void> {
      await transact(state => {
        delete state.ips[ipKey(ip)];
        return { state, result: undefined };
      });
    },
  };
}

export type PinGuard = ReturnType<typeof createPinGuard>;
