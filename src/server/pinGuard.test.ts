import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  createFirestorePinGuardStore,
  createMemoryPinGuardStore,
  createPinGuard,
  PIN_GUARD_LIMITS,
  type PinGuardStore,
} from './pinGuard';

const MINUTE = 60_000;

function clock(start = Date.UTC(2026, 8, 23)) {
  let current = start;
  return { now: () => current, advance: (ms: number) => { current += ms; } };
}

// Minimal transactional Firestore double: one document map, writes applied on commit.
function firestoreDouble() {
  const records = new Map<string, unknown>();
  const ref = (path: string): any => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  });
  const db = {
    doc: (path: string) => ref(path),
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (callback: any) => {
      const writes: Array<() => void> = [];
      const result = await callback({
        get: async (reference: any) => ({
          exists: records.has(reference.path),
          data: () => structuredClone(records.get(reference.path)),
        }),
        set: (reference: any, data: unknown) => { writes.push(() => records.set(reference.path, structuredClone(data))); },
      });
      writes.forEach(write => write());
      return result;
    },
  };
  return { db: db as unknown as Firestore, records };
}

function failingStore(): PinGuardStore {
  return { transact: async () => { throw new Error('firestore unavailable'); } };
}

async function fail(guard: ReturnType<typeof createPinGuard>, ip: string, times = 1) {
  let last = { retryAfterMs: 0 };
  for (let index = 0; index < times; index += 1) last = await guard.recordFailure(ip);
  return last;
}

describe('pin guard: per-IP limit', () => {
  it('allows the first four failures without delay', async () => {
    const time = clock();
    const guard = createPinGuard({ store: createMemoryPinGuardStore(), now: time.now });
    const result = await fail(guard, '1.1.1.1', 4);
    expect(result.retryAfterMs).toBe(0);
    expect(await guard.check('1.1.1.1')).toEqual({ allowed: true });
  });

  it('blocks an IP after 5 failures within 10 minutes', async () => {
    const time = clock();
    const guard = createPinGuard({ store: createMemoryPinGuardStore(), now: time.now });
    const result = await fail(guard, '1.1.1.1', 5);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    const check = await guard.check('1.1.1.1');
    expect(check).toMatchObject({ allowed: false, scope: 'ip' });
  });

  it('grows the delay exponentially and caps it at 15 minutes', async () => {
    const time = clock();
    const guard = createPinGuard({ store: createMemoryPinGuardStore(), now: time.now });
    const delays: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      delays.push((await guard.recordFailure('1.1.1.1')).retryAfterMs);
    }
    const blocked = delays.slice(4);
    for (let index = 1; index < blocked.length; index += 1) {
      expect(blocked[index]).toBeGreaterThanOrEqual(blocked[index - 1]);
    }
    expect(Math.max(...delays)).toBe(PIN_GUARD_LIMITS.ipMaxDelayMs);
    expect(PIN_GUARD_LIMITS.ipMaxDelayMs).toBe(15 * MINUTE);
  });

  it('forgets an IP whose failures are older than the 10 minute window', async () => {
    const time = clock();
    const guard = createPinGuard({ store: createMemoryPinGuardStore(), now: time.now });
    await fail(guard, '1.1.1.1', 4);
    time.advance(11 * MINUTE);
    expect((await guard.recordFailure('1.1.1.1')).retryAfterMs).toBe(0);
  });

  it('keeps different IPs independent', async () => {
    const time = clock();
    const guard = createPinGuard({ store: createMemoryPinGuardStore(), now: time.now });
    await fail(guard, '1.1.1.1', 6);
    expect(await guard.check('1.1.1.1')).toMatchObject({ allowed: false });
    expect(await guard.check('2.2.2.2')).toEqual({ allowed: true });
  });

  it('resets only the successful IP, not the deployment-wide counter', async () => {
    const time = clock();
    const store = createMemoryPinGuardStore();
    const guard = createPinGuard({ store, now: time.now });
    await fail(guard, '1.1.1.1', 4);
    await guard.recordSuccess('1.1.1.1');
    expect((await guard.recordFailure('1.1.1.1')).retryAfterMs).toBe(0);
    expect(store.peek().global.failures).toHaveLength(5);
  });
});

describe('pin guard: deployment-wide limit', () => {
  it('locks every PIN check for 15 minutes after 30 failures in an hour', async () => {
    const time = clock();
    const guard = createPinGuard({ store: createMemoryPinGuardStore(), now: time.now });
    for (let index = 0; index < PIN_GUARD_LIMITS.globalMaxFailures; index += 1) {
      time.advance(MINUTE);
      await guard.recordFailure(`10.0.0.${index}`);
    }
    const check = await guard.check('203.0.113.9');
    expect(check).toMatchObject({ allowed: false, scope: 'global' });
    expect((check as { retryAfterMs: number }).retryAfterMs).toBe(15 * MINUTE);

    time.advance(15 * MINUTE);
    expect(await guard.check('203.0.113.9')).toEqual({ allowed: true });
  });

  it('does not lock when 30 failures are spread over more than an hour', async () => {
    const time = clock();
    const guard = createPinGuard({ store: createMemoryPinGuardStore(), now: time.now });
    for (let index = 0; index < PIN_GUARD_LIMITS.globalMaxFailures; index += 1) {
      await guard.recordFailure(`10.0.0.${index}`);
      time.advance(3 * MINUTE);
    }
    expect(await guard.check('203.0.113.9')).toEqual({ allowed: true });
  });

  it('raises an alert once when the global lock engages', async () => {
    const time = clock();
    const onGlobalLock = vi.fn();
    const guard = createPinGuard({ store: createMemoryPinGuardStore(), now: time.now, onGlobalLock });
    for (let index = 0; index < 35; index += 1) await guard.recordFailure(`10.0.1.${index}`);
    expect(onGlobalLock).toHaveBeenCalledTimes(1);
  });
});

describe('pin guard: persistence', () => {
  it('shares the counters through Firestore so a restart does not reset them', async () => {
    const time = clock();
    const { db, records } = firestoreDouble();
    const before = createPinGuard({ store: createFirestorePinGuardStore(db), now: time.now });
    for (let index = 0; index < PIN_GUARD_LIMITS.globalMaxFailures; index += 1) {
      await before.recordFailure(`10.0.2.${index}`);
    }
    expect(records.has('system/pinGuard')).toBe(true);

    const afterRestart = createPinGuard({ store: createFirestorePinGuardStore(db), now: time.now });
    expect(await afterRestart.check('198.51.100.1')).toMatchObject({ allowed: false, scope: 'global' });
  });

  it('does not store raw IP addresses in the shared document', async () => {
    const time = clock();
    const { db, records } = firestoreDouble();
    const guard = createPinGuard({ store: createFirestorePinGuardStore(db), now: time.now });
    await guard.recordFailure('192.0.2.77');
    expect(JSON.stringify(records.get('system/pinGuard'))).not.toContain('192.0.2.77');
  });

  it('falls back to memory instead of failing open when Firestore is down', async () => {
    const time = clock();
    const guard = createPinGuard({ store: failingStore(), now: time.now, log: vi.fn() });
    await fail(guard, '1.1.1.1', 5);
    expect(await guard.check('1.1.1.1')).toMatchObject({ allowed: false, scope: 'ip' });
  });

  it('prunes expired IP entries so the state stays bounded', async () => {
    const time = clock();
    const store = createMemoryPinGuardStore();
    const guard = createPinGuard({ store, now: time.now });
    for (let index = 0; index < 50; index += 1) await guard.recordFailure(`10.1.0.${index}`);
    time.advance(2 * 60 * MINUTE);
    await guard.recordFailure('10.9.9.9');
    expect(Object.keys(store.peek().ips)).toHaveLength(1);
    expect(store.peek().global.failures).toHaveLength(1);
  });
});
