import { createHash } from 'node:crypto';
import type { RouteDeps } from '../routes/types';

export interface AiDailyUsageStore {
  consume(uid: string, day: string): Promise<boolean>;
}
export function firestoreAiUsageStore(deps: RouteDeps): AiDailyUsageStore {
  return {
    consume: async (uid, day) => {
      const { adminDb } = deps.getAdminServices();
      const reference = adminDb.doc(`users/${uid}/aiUsage/${day}`);
      return adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const used = Number(snapshot.data()?.count || 0);
        if (!Number.isSafeInteger(used) || used < 0 || used >= 30) return false;
        transaction.set(reference, { count: used + 1, day }, { merge: true });
        return true;
      });
    },
  };
}

export class BudgetAiLimitError extends Error {}
export function createBudgetAiRuntime(
  store: AiDailyUsageStore,
  options: { now?: () => number; timeoutMs?: number; cacheTtlMs?: number; maxEntries?: number } = {},
) {
  const now = options.now || Date.now;
  const cache = new Map<string, { expires: number; value: unknown }>();
  const inFlight = new Map<string, Promise<unknown>>();
  const ttl = options.cacheTtlMs ?? 15 * 60_000;
  return {
    async run<T>(
      uid: string,
      kind: string,
      context: unknown,
      generate: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
      // No raw input text in logs, cache keys, or Firestore usage documents.
      const key = createHash('sha256')
        .update(JSON.stringify([uid, kind, context]))
        .digest('hex');
      const cached = cache.get(key);
      if (cached && cached.expires > now()) return structuredClone(cached.value) as T;
      cache.delete(key);
      const pending = inFlight.get(key);
      if (pending) return structuredClone(await pending) as T;
      if (inFlight.size >= (options.maxEntries ?? 500)) throw new Error('AI 요청이 많습니다. 잠시 후 시도해 주세요.');
      const operation = (async () => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('AI 요청 시간이 초과되었습니다.'));
          }, options.timeoutMs ?? 4500);
        });
        try {
          const result = await Promise.race([
            timeout,
            (async () => {
              const day = new Date(now() + 9 * 60 * 60_000).toISOString().slice(0, 10);
              if (!(await store.consume(uid, day)))
                throw new BudgetAiLimitError('오늘 AI 호출 한도 30회를 모두 사용했습니다.');
              controller.signal.throwIfAborted();
              return generate(controller.signal);
            })(),
          ]);
          cache.set(key, { expires: now() + ttl, value: result });
          while (cache.size > (options.maxEntries ?? 500)) cache.delete(cache.keys().next().value);
          return result;
        } finally {
          clearTimeout(timer!);
        }
      })();
      inFlight.set(key, operation);
      try {
        return structuredClone(await operation) as T;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}
export type BudgetAiRuntime = ReturnType<typeof createBudgetAiRuntime>;
