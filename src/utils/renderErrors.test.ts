import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRecordedRenderErrors, recordRenderError } from './renderErrors';
import { planCacheReset, resetAppCache } from './cacheReset';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

describe('render error records', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  it('keeps name, message and component stack, and only the last 10', () => {
    for (let index = 0; index < 12; index += 1) {
      recordRenderError('analytics', new TypeError(`boom ${index}`), '\n    at Chart');
    }
    const records = getRecordedRenderErrors();
    expect(records).toHaveLength(10);
    expect(records[9]).toMatchObject({ scope: 'analytics', name: 'TypeError', message: 'boom 11', componentStack: 'at Chart' });
    expect(records[0].message).toBe('boom 2');
  });

  it('survives unreadable storage', () => {
    localStorage.setItem('eb_render_errors', '{not json');
    expect(getRecordedRenderErrors()).toEqual([]);
    expect(() => recordRenderError('app', 'plain string')).not.toThrow();
  });
});

describe('cache reset', () => {
  const fill = (entries: Record<string, string>) => {
    const storage = new MemoryStorage();
    Object.entries(entries).forEach(([key, value]) => storage.setItem(key, value));
    return storage;
  };

  it('removes only app keys and keeps the login session', () => {
    const storage = fill({
      brake_transactions: '[]',
      eb_something: '1',
      eb_session_token: 'tok',
      eb_session_account: '{}',
      unrelated: 'x',
    });
    const plan = planCacheReset(storage);
    expect(plan.remove.sort()).toEqual(['brake_transactions', 'eb_something']);
    expect(plan.keptOutboxes).toEqual([]);
  });

  it('keeps an outbox that still has unsent changes, per account', () => {
    const storage = fill({
      brake_firestore_outbox: '[{"id":"1"}]',
      'brake_firestore_outbox:wife': '[]',
      brake_other: '1',
    });
    const plan = planCacheReset(storage);
    expect(plan.keptOutboxes).toEqual(['brake_firestore_outbox']);
    expect(plan.remove.sort()).toEqual(['brake_firestore_outbox:wife', 'brake_other']);
  });

  it('treats an unreadable outbox as pending', () => {
    expect(planCacheReset(fill({ brake_firestore_outbox: '{broken' })).keptOutboxes).toEqual(['brake_firestore_outbox']);
  });

  it('resetAppCache deletes the planned keys', () => {
    const storage = fill({ brake_a: '1', unrelated: '2' }) as unknown as Storage;
    resetAppCache(storage);
    expect(storage.getItem('brake_a')).toBeNull();
    expect(storage.getItem('unrelated')).toBe('2');
  });
});
