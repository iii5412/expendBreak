/**
 * Fixed-window request limiter keyed by account.
 *
 * It protects AI spend, so per-instance memory is enough. Expired windows are
 * swept as time passes and the table is capped, so one long-lived instance
 * cannot grow without bound. (PIN attempts need a shared limit instead: see pinGuard.)
 */
export interface RateLimiter {
  /** Counts one request; false means the key has used up its window. */
  consume(key: string): boolean;
  readonly name: string;
  readonly size: number;
}

export function createRateLimiter({
  name,
  windowMs,
  max,
  maxKeys = 10_000,
  now = Date.now,
}: {
  name: string;
  windowMs: number;
  max: number;
  maxKeys?: number;
  now?: () => number;
}): RateLimiter {
  const windows = new Map<string, { startedAt: number; count: number }>();
  let lastSweep = now();

  function sweep(at: number) {
    lastSweep = at;
    for (const [key, window] of windows) {
      if (at - window.startedAt >= windowMs) windows.delete(key);
    }
  }

  return {
    name,
    get size() {
      return windows.size;
    },
    consume(key) {
      const at = now();
      if (at - lastSweep >= windowMs) sweep(at);

      const current = windows.get(key);
      if (!current || at - current.startedAt >= windowMs) {
        // Re-insert so the Map's order stays oldest-first.
        windows.delete(key);
        windows.set(key, { startedAt: at, count: 1 });
        while (windows.size > maxKeys) {
          const oldest = windows.keys().next().value;
          if (oldest === undefined) break;
          windows.delete(oldest);
        }
        return true;
      }
      if (current.count >= max) return false;
      current.count += 1;
      return true;
    },
  };
}

const TEN_MINUTES = 10 * 60_000;

/** The AI limits the server used before they were unified; values are unchanged. */
export function createAiLimiters() {
  return {
    realtime: createRateLimiter({ name: 'realtime', windowMs: TEN_MINUTES, max: 20 }),
    financeChat: createRateLimiter({ name: 'financeChat', windowMs: TEN_MINUTES, max: 40 }),
    // Counted per model step; one request usually takes 2-4 steps.
    agent: createRateLimiter({ name: 'agent', windowMs: TEN_MINUTES, max: 150 }),
    ocr: createRateLimiter({ name: 'ocr', windowMs: TEN_MINUTES, max: 20 }),
    voice: createRateLimiter({ name: 'voice', windowMs: TEN_MINUTES, max: 30 }),
  };
}

export type AiLimiters = ReturnType<typeof createAiLimiters>;
