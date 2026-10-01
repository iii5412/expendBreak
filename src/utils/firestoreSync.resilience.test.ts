import { beforeEach, describe, expect, it, vi } from 'vitest';

type Target = { kind: 'collection' | 'doc'; name: string; id?: string };
const listeners = new Map<string, (snapshot: unknown) => void>();
const setDocMock = vi.fn(async (..._args: unknown[]) => undefined);
const getDocsMock = vi.fn(async (..._args: unknown[]) => ({ docs: [] as unknown[] }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, _users: string, _uid: string, name: string): Target => ({ kind: 'collection', name }),
  doc: (_db: unknown, _users: string, _uid: string, name: string, id: string): Target => ({ kind: 'doc', name, id }),
  query: (target: Target) => target,
  where: () => ({}),
  onSnapshot: (target: Target, callback: (snapshot: unknown) => void) => {
    listeners.set(target.kind === 'doc' ? `doc:${target.name}` : target.name, callback);
    return () => undefined;
  },
  setDoc: (...args: unknown[]) => setDocMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  getDoc: vi.fn(),
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
}));
vi.mock('../lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('./auth', () => ({
  getAccountStorageKey: (key: string) => key,
  getSignedInAccount: () => ({ uid: 'owner', name: 'o', isOwner: true }),
}));

class MemoryStorage {
  values = new Map<string, string>();
  /** Total characters allowed; exceeding it throws like a full browser. */
  capacity = Infinity;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    const others = [...this.values].filter(([name]) => name !== key).reduce((sum, [, v]) => sum + v.length, 0);
    if (others + value.length > this.capacity) {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    }
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

const docSnapshot = (docs: Array<{ id: string; data: Record<string, unknown> }>) => ({
  docs: docs.map(({ id, data }) => ({ id, data: () => data })),
});

async function boot() {
  const sync = await import('./firestoreSync');
  const status = await import('./syncStatus');
  const started = sync.initFirestoreSync(() => undefined, '2026-08-01');
  // The first round settles once every source has delivered a snapshot.
  const empty = docSnapshot([]);
  for (const name of ['categories', 'budgets', 'recurringTemplates', 'recurringOccurrences', 'merchantRules',
    'bankAccounts', 'paymentCards', 'quickEntries', 'cycleBaselines']) listeners.get(name)?.(empty);
  listeners.get('doc:appSettings')?.({ exists: () => false, data: () => ({}) });
  listeners.get('transactions')?.(empty);
  await started;
  return { sync, status };
}

const readCache = <T,>(key: string): T => JSON.parse(localStorage.getItem(key) || 'null');

let storage: MemoryStorage;
beforeEach(() => {
  vi.resetModules();
  listeners.clear();
  setDocMock.mockClear();
  getDocsMock.mockReset();
  getDocsMock.mockResolvedValue({ docs: [] });
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('navigator', { onLine: true });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('R3: a snapshot must not hide changes still waiting in the outbox', () => {
  it('keeps a transaction queued offline when the first snapshot arrives before the flush', async () => {
    storage.setItem('brake_firestore_outbox', JSON.stringify([{
      id: 'write_1',
      operation: 'set',
      collectionName: 'transactions',
      documentId: 'offline-1',
      data: { id: 'offline-1', type: 'expense', amount: 4500, localDate: '2026-09-27', occurredAt: '2026-09-27T01:00:00.000Z' },
      queuedAt: '2026-09-27T01:00:00.000Z',
    }]));
    await boot();

    // The server knows nothing about the offline entry yet.
    listeners.get('transactions')?.(docSnapshot([
      { id: 'server-1', data: { type: 'expense', amount: 100, localDate: '2026-09-01', occurredAt: '2026-09-01T00:00:00.000Z' } },
    ]));

    const cached = readCache<Array<{ id: string }>>('brake_transactions');
    expect(cached.map(item => item.id).sort()).toEqual(['offline-1', 'server-1']);
  });

  it('applies a pending delete and a pending settings change over the snapshot', async () => {
    storage.setItem('brake_firestore_outbox', JSON.stringify([
      { id: 'w1', operation: 'delete', collectionName: 'categories', documentId: 'old', queuedAt: '2026-09-27T01:00:00.000Z' },
      { id: 'w2', operation: 'set', collectionName: 'appSettings', documentId: 'global', data: { monthStartDay: 25 }, queuedAt: '2026-09-27T01:00:01.000Z' },
      { id: 'w3', operation: 'set', collectionName: 'budgets', documentId: '2026-09', data: { yearMonth: '2026-09', totalLimit: 300000 }, queuedAt: '2026-09-27T01:00:02.000Z' },
    ]));
    await boot();

    listeners.get('categories')?.(docSnapshot([{ id: 'old', data: { name: 'x' } }, { id: 'keep', data: { name: 'y' } }]));
    listeners.get('doc:appSettings')?.({ exists: () => true, data: () => ({ monthStartDay: 1, theme: 'dark' }) });
    listeners.get('budgets')?.(docSnapshot([]));

    expect(readCache<Array<{ id: string }>>('brake_categories').map(item => item.id)).toEqual(['keep']);
    expect(readCache<Record<string, unknown>>('brake_user_profile')).toMatchObject({ monthStartDay: 25, theme: 'dark' });
    expect(readCache<Record<string, { totalLimit: number }>>('brake_budgets')['2026-09'].totalLimit).toBe(300000);
  });
});

describe('R2: the local transaction cache leaves out OCR text', () => {
  it('stores no rawText for 100 receipt transactions', async () => {
    await boot();
    const docs = Array.from({ length: 100 }, (_, index) => ({
      id: `t${index}`,
      data: {
        type: 'expense', amount: 1000, localDate: '2026-09-20', occurredAt: '2026-09-20T00:00:00.000Z',
        receipt: { id: `r${index}`, lineItems: [], rawText: 'ocr '.repeat(1000), ocrConfidence: 0.9, scannedAt: 'now' },
      },
    }));
    listeners.get('transactions')?.(docSnapshot(docs));

    const raw = localStorage.getItem('brake_transactions') || '';
    expect(raw).not.toContain('"rawText"');
    expect(raw).not.toContain('ocr ocr');
    const cached = readCache<Array<{ receipt: { rawTextOmitted?: boolean } }>>('brake_transactions');
    expect(cached).toHaveLength(100);
    expect(cached.every(item => item.receipt.rawTextOmitted === true)).toBe(true);
  });

  it('writes an edited cached receipt transaction with merge so the cloud text survives', async () => {
    const { sync } = await boot();
    await sync.syncTransactionToFirestore({
      id: 't1', type: 'expense', amount: 2000,
      receipt: { id: 'r', lineItems: [], rawTextOmitted: true, ocrConfidence: 1, scannedAt: 'now' },
    } as never);
    const [, data, options] = setDocMock.mock.calls[0] as [unknown, { receipt: Record<string, unknown> }, unknown];
    expect(options).toEqual({ merge: true });
    expect(data.receipt).not.toHaveProperty('rawTextOmitted');
  });
});

describe('R1: a full device', () => {
  it('frees the AI report cache and retries, without raising the banner', async () => {
    const { status } = await boot();
    storage.setItem('brake_ai_insights', 'x'.repeat(400));
    storage.capacity = 700;
    listeners.get('categories')?.(docSnapshot(Array.from({ length: 20 }, (_, index) => ({ id: `c${index}`, data: { name: 'n' } }))));

    expect(storage.getItem('brake_ai_insights')).toBeNull();
    expect(readCache<unknown[]>('brake_categories')).toHaveLength(20);
    expect(status.getSyncState().storageFull).toBe(false);
  });

  it('raises storageFull when nothing more can be freed, and clears it once the write fits', async () => {
    const { status } = await boot();
    storage.capacity = 50;
    listeners.get('categories')?.(docSnapshot(Array.from({ length: 20 }, (_, index) => ({ id: `c${index}`, data: { name: 'n' } }))));
    expect(status.getSyncState().storageFull).toBe(true);

    storage.capacity = Infinity;
    listeners.get('categories')?.(docSnapshot([{ id: 'c0', data: { name: 'n' } }]));
    expect(status.getSyncState().storageFull).toBe(false);
  });

  it('still sends a change straight to Firestore when the outbox cannot be stored', async () => {
    const { sync, status } = await boot();
    storage.capacity = 10;
    const ok = await sync.syncTransactionToFirestore({ id: 't1', type: 'expense', amount: 1 } as never);

    expect(ok).toBe(true);
    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(status.getSyncState().storageFull).toBe(true);
    expect(localStorage.getItem('brake_firestore_outbox')).toBeNull();
  });

  it('reports a failed direct write instead of pretending it was saved', async () => {
    const { sync } = await boot();
    storage.capacity = 10;
    setDocMock.mockRejectedValueOnce(new Error('offline'));
    expect(await sync.syncTransactionToFirestore({ id: 't2', type: 'expense', amount: 1 } as never)).toBe(false);
  });
});

describe('R4: full reset errors are not swallowed', () => {
  it('rejects when a collection cannot be read', async () => {
    const { sync } = await boot();
    getDocsMock.mockRejectedValueOnce(new Error('network down'));
    await expect(sync.clearFirestoreAllData()).rejects.toThrow('network down');
  });
});
