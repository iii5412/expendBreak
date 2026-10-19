import { describe, expect, it, vi } from 'vitest';
import { BudgetAiLimitError, createBudgetAiRuntime, firestoreAiUsageStore } from './budgetAiRuntime';
import type { RouteDeps } from '../routes/types';

describe('AI quota, cache and deadline', () => {
  it('coalesces identical in-flight requests, isolates accounts and expires cached output', async () => {
    let at = Date.parse('2026-10-19T15:01:00Z');
    const consume = vi.fn(async () => true);
    const runtime = createBudgetAiRuntime({ consume }, { now: () => at, cacheTtlMs: 10 });
    let release: (result: { value: number }) => void;
    const generate = vi.fn(() => new Promise<{ value: number }>(resolve => { release = resolve; }));
    const a = runtime.run('a', 'classify', { text: 'unknown' }, generate);
    const b = runtime.run('a', 'classify', { text: 'unknown' }, generate);
    await Promise.resolve();
    release({ value: 1 });
    expect(await Promise.all([a, b])).toEqual([{ value: 1 }, { value: 1 }]);
    await runtime.run('a', 'classify', { text: 'unknown' }, generate);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith('a', '2026-10-20');
    await runtime.run('b', 'classify', { text: 'unknown' }, async () => ({ value: 2 }));
    at += 11;
    await runtime.run('a', 'classify', { text: 'unknown' }, async () => ({ value: 3 }));
    expect(consume).toHaveBeenCalledTimes(3);
  });
  it('does not call a provider after quota rejection or quota-store failure', async () => {
    const generate = vi.fn();
    await expect(createBudgetAiRuntime({ consume: async () => false }).run('a', 'feedback', {}, generate)).rejects.toBeInstanceOf(BudgetAiLimitError);
    await expect(createBudgetAiRuntime({ consume: async () => { throw new Error('store unavailable'); } }).run('a', 'feedback', {}, generate)).rejects.toThrow('store unavailable');
    expect(generate).not.toHaveBeenCalled();
  });
  it('bounds slow calls, aborts the provider and never caches timeouts', async () => {
    let signal: AbortSignal;
    const consume = vi.fn(async () => true);
    const runtime = createBudgetAiRuntime({ consume }, { timeoutMs: 15 });
    await expect(runtime.run('a', 'classify', {}, async received => { signal = received; return new Promise(() => undefined); })).rejects.toThrow('초과');
    expect(signal.aborted).toBe(true);
    expect(await runtime.run('a', 'classify', {}, async () => 'recovered')).toBe('recovered');
    expect(consume).toHaveBeenCalledTimes(2);
  });
  it('uses a Firestore transaction for the 30-call cap without storing prompts', async () => {
    let count = 29;
    const set = vi.fn((_ref, data: { count: number }) => { count = data.count; });
    const doc = vi.fn((path: string) => path);
    const runTransaction = vi.fn(async work => work({ get: async () => ({ data: () => ({ count }) }), set }));
    const store = firestoreAiUsageStore({ getAdminServices: () => ({ adminDb: { doc, runTransaction } }) } as unknown as RouteDeps);
    expect(await store.consume('user-a', '2026-10-19')).toBe(true);
    expect(await store.consume('user-a', '2026-10-19')).toBe(false);
    expect(doc).toHaveBeenCalledWith('users/user-a/aiUsage/2026-10-19');
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][1]).toEqual({ count: 30, day: '2026-10-19' });
  });
});
