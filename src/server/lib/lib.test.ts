import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { listen } from '../testServer';
import { logger, redactSensitive, requestLogging, setLogSink } from './logger';
import { createRateLimiter } from './rateLimiter';

describe('rate limiter', () => {
  it('allows `max` requests per window per key, then refuses until the window passes', () => {
    let clock = 0;
    const limiter = createRateLimiter({ name: 't', windowMs: 1_000, max: 2, now: () => clock });
    expect([limiter.consume('a'), limiter.consume('a'), limiter.consume('a')]).toEqual([true, true, false]);
    expect(limiter.consume('b')).toBe(true);
    clock = 1_000;
    expect(limiter.consume('a')).toBe(true);
  });

  it('forgets expired keys as time passes', () => {
    let clock = 0;
    const limiter = createRateLimiter({ name: 't', windowMs: 1_000, max: 1, now: () => clock });
    for (let index = 0; index < 50; index += 1) limiter.consume(`k${index}`);
    expect(limiter.size).toBe(50);
    clock = 5_000;
    limiter.consume('fresh');
    expect(limiter.size).toBe(1);
  });

  it('never holds more than maxKeys, dropping the oldest first', () => {
    const limiter = createRateLimiter({ name: 't', windowMs: 60_000, max: 1, maxKeys: 3 });
    ['a', 'b', 'c', 'd'].forEach(key => limiter.consume(key));
    expect(limiter.size).toBe(3);
    // `a` was evicted, so it gets a fresh window; `d` is still limited.
    expect(limiter.consume('a')).toBe(true);
    expect(limiter.consume('d')).toBe(false);
  });
});

describe('log redaction', () => {
  it('masks bearer tokens and long digit runs', () => {
    expect(redactSensitive('auth Bearer abc.def-123 failed')).toBe('auth Bearer [redacted] failed');
    expect(redactSensitive('card 1234-5678-9012-3456 and 110234567890')).toBe('card [digits] and [digits]');
    expect(redactSensitive('amount 12000 won')).toBe('amount 12000 won');
  });
});

describe('structured request logging', () => {
  let running: Awaited<ReturnType<typeof listen>> | null = null;
  let restore: (() => void) | null = null;
  afterEach(async () => {
    restore?.();
    await running?.close();
    running = null;
  });

  async function start() {
    const lines: Array<Record<string, unknown>> = [];
    restore = setLogSink(line => lines.push(JSON.parse(line)));
    const app = express();
    app.use(requestLogging());
    app.get('/api/thing', (_req, res) => {
      logger.error('handler failed', new Error('boom'), 'Bearer secret-token-value');
      res.locals.userUid = 'wife';
      res.status(500).json({});
    });
    app.get('/page', (_req, res) => res.send('ok'));
    running = await listen(app);
    return lines;
  }

  it('gives every line of one request the same id and echoes it in X-Request-Id', async () => {
    const lines = await start();
    const response = await fetch(running!.url('/api/thing'));
    const id = response.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const handlerLine = lines.find(line => String(line.message).startsWith('handler failed'))!;
    const summary = lines.find(line => line.message === 'request')!;
    expect(handlerLine).toMatchObject({ severity: 'ERROR', requestId: id });
    expect(summary).toMatchObject({ severity: 'ERROR', requestId: id, status: 500, route: 'GET /api/thing' });
    expect(typeof summary.latencyMs).toBe('number');
    expect(JSON.stringify(lines)).not.toContain('secret-token-value');
  });

  it('keeps a sane incoming request id and replaces a malformed one', async () => {
    await start();
    const kept = await fetch(running!.url('/api/thing'), { headers: { 'X-Request-Id': 'trace-abc-12345' } });
    expect(kept.headers.get('x-request-id')).toBe('trace-abc-12345');
    const replaced = await fetch(running!.url('/api/thing'), { headers: { 'X-Request-Id': 'bad id with spaces' } });
    expect(replaced.headers.get('x-request-id')).not.toBe('bad id with spaces');
  });

  it('does not log summary lines for non-API requests', async () => {
    const lines = await start();
    await fetch(running!.url('/page'));
    expect(lines).toHaveLength(0);
  });
});
