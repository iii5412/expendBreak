import { describe, expect, it, vi } from 'vitest';
import { overlayDocument, overlayList, overlayMap, pendingChangesFor, type OverlayEntry } from './outboxOverlay';
import { stripReceiptBulk, toCloudTransactionWrite } from './receiptCache';
import { getStorageUsage, totalStorageKb } from './storageUsage';
import type { Transaction } from '../types';

const tx = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'expense', amount: 1000, localDate: '2026-09-20', ...extra }) as unknown as Transaction;

describe('outbox overlay', () => {
  const outbox: OverlayEntry[] = [
    { operation: 'set', collectionName: 'transactions', documentId: 'new', data: { id: 'new', amount: 5 } },
    { operation: 'delete', collectionName: 'transactions', documentId: 'gone' },
    { operation: 'set', collectionName: 'categories', documentId: 'c1', data: { id: 'c1', name: 'x' } },
    {
      operation: 'conditional',
      collectionName: 'recurringOccurrences',
      documentId: 'o1',
      documents: [
        { collectionName: 'recurringOccurrences', documentId: 'o1', data: { revision: 2 } },
        { collectionName: 'transactions', documentId: 'posted', data: { id: 'posted', amount: 7 } },
        { collectionName: 'transactions', documentId: 'removed', remove: true },
      ],
    },
  ];

  it('collects only the changes of one collection, including conditional documents', () => {
    expect(pendingChangesFor('transactions', outbox).map(change => `${change.kind}:${change.id}`))
      .toEqual(['set:new', 'delete:gone', 'set:posted', 'delete:removed']);
  });

  it('lays pending sets and deletes over a server list', () => {
    const server = [tx('a'), tx('gone'), tx('removed')];
    const result = overlayList(server, pendingChangesFor('transactions', outbox));
    expect(result.map(item => item.id).sort()).toEqual(['a', 'new', 'posted']);
  });

  it('merges a pending partial write into the server copy', () => {
    const result = overlayList(
      [tx('a', { memo: 'keep' })],
      [{ kind: 'set', id: 'a', data: { amount: 9 }, merge: true }],
    );
    expect(result[0]).toMatchObject({ id: 'a', memo: 'keep', amount: 9 });
  });

  it('overlays keyed maps and single documents', () => {
    const map = overlayMap(
      { '2026-09': { yearMonth: '2026-09', limit: 1 } },
      [{ kind: 'set', id: '2026-10', data: { yearMonth: '2026-10', limit: 2 } }, { kind: 'delete', id: '2026-09' }],
      (id, data) => String(data?.yearMonth || id),
    );
    expect(Object.keys(map)).toEqual(['2026-10']);
    expect(overlayDocument({ a: 1 }, [{ kind: 'set', id: 'g', data: { b: 2 }, merge: true }])).toEqual({ a: 1, b: 2 });
    expect(overlayDocument(null, [{ kind: 'set', id: 'g', data: { b: 2 } }])).toEqual({ b: 2 });
    expect(overlayDocument({ a: 1 }, [{ kind: 'delete', id: 'g' }])).toBeNull();
  });

  it('returns the same list when nothing is pending', () => {
    const list = [tx('a')];
    expect(overlayList(list, [])).toBe(list);
  });
});

describe('receipt cache trimming', () => {
  const receipt = { id: 'r', lineItems: [{ name: 'milk', amount: 1 }], rawText: 'x'.repeat(5000), ocrConfidence: 0.9, scannedAt: 'now' };

  it('drops the OCR text from the cached copy and marks it', () => {
    const stripped = stripReceiptBulk(tx('a', { receipt }));
    expect(stripped.receipt).not.toHaveProperty('rawText');
    expect(stripped.receipt).toMatchObject({ rawTextOmitted: true, lineItems: receipt.lineItems });
    expect(JSON.stringify(stripped).length).toBeLessThan(JSON.stringify(tx('a', { receipt })).length / 5);
  });

  it('leaves transactions without a receipt, or already trimmed, alone', () => {
    const plain = tx('a');
    expect(stripReceiptBulk(plain)).toBe(plain);
    const once = stripReceiptBulk(tx('a', { receipt }));
    expect(stripReceiptBulk(once)).toBe(once);
  });

  it('writes a trimmed copy back with merge and without the flag, so cloud text survives', () => {
    const stripped = stripReceiptBulk(tx('a', { receipt }));
    const write = toCloudTransactionWrite(stripped as unknown as Record<string, unknown>);
    expect(write.merge).toBe(true);
    expect(write.data.receipt).not.toHaveProperty('rawTextOmitted');
    expect(write.data.receipt).not.toHaveProperty('rawText');
    expect(toCloudTransactionWrite({ amount: 1, receipt }).merge).toBe(false);
    expect(toCloudTransactionWrite({ amount: 1 }).merge).toBe(false);
  });
});

describe('storage usage', () => {
  it('lists only app keys, largest first, in KB', () => {
    const values = new Map([
      ['brake_transactions', 'x'.repeat(2048)],
      ['eb_session_token', 'tok'],
      ['other_app', 'y'.repeat(9999)],
    ]);
    const storage = {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
    };
    const usage = getStorageUsage(storage);
    expect(usage.map(entry => entry.key)).toEqual(['brake_transactions', 'eb_session_token']);
    expect(usage[0].kb).toBeCloseTo(4.0, 0);
    expect(totalStorageKb(usage)).toBeGreaterThanOrEqual(usage[0].kb);
  });
});

describe('module wiring', () => {
  it('imports without side effects on an empty environment', async () => {
    vi.resetModules();
    await expect(import('./safeStorage')).resolves.toBeDefined();
  });
});

describe('failed request records', () => {
  it('keeps the latest 20, path only, with the server request id', async () => {
    const { clearFailedRequests, getRecentFailedRequests, recordFailedRequest } = await import('./requestErrors');
    clearFailedRequests();
    for (let index = 0; index < 25; index += 1) {
      recordFailedRequest({ method: 'post', url: `https://app.example.com/api/ai/feedback?month=2026-09&q=${index}`, status: 502, requestId: `id-${index}` });
    }
    const recent = getRecentFailedRequests();
    expect(recent).toHaveLength(20);
    expect(recent[19]).toMatchObject({ method: 'POST', path: '/api/ai/feedback', status: 502, requestId: 'id-24' });
    expect(JSON.stringify(recent)).not.toContain('2026-09');
  });
});
