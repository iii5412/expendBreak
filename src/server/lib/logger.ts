import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/**
 * One JSON object per line, which Cloud Logging reads as a structured entry
 * (`severity` and `message` are its well-known fields). Every line written
 * while a request is being handled carries that request's id, so a single
 * request can be followed across the log.
 */
export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

interface RequestContext {
  requestId: string;
  route?: string;
  uid?: string;
}

const contextStore = new AsyncLocalStorage<RequestContext>();

type LogSink = (line: string) => void;
let sink: LogSink = line => {
  process.stdout.write(`${line}\n`);
};

/** Replaces where lines go; tests use it to capture output. Returns a restore function. */
export function setLogSink(next: LogSink): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

const MAX_MESSAGE_LENGTH = 2_000;

/** Tokens and long digit runs (card/account numbers) never belong in a log line. */
export function redactSensitive(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\d(?:[ -]?\d){8,}/g, '[digits]');
}

function describeDetail(detail: unknown): string {
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`;
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail) ?? String(detail);
  } catch {
    return String(detail);
  }
}

function write(severity: Severity, message: string, details: unknown[], fields: Record<string, unknown> = {}) {
  const context = contextStore.getStore();
  const text = redactSensitive([message, ...details.map(describeDetail)].join(' ')).slice(0, MAX_MESSAGE_LENGTH);
  sink(JSON.stringify({
    severity,
    message: text,
    ...(context ? { requestId: context.requestId, route: context.route, uid: context.uid } : {}),
    ...fields,
  }));
}

export const logger = {
  debug: (message: string, ...details: unknown[]) => write('DEBUG', message, details),
  info: (message: string, ...details: unknown[]) => write('INFO', message, details),
  warn: (message: string, ...details: unknown[]) => write('WARNING', message, details),
  error: (message: string, ...details: unknown[]) => write('ERROR', message, details),
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Assigns a request id (kept when the caller or proxy already sent a sane
 * one), echoes it as `X-Request-Id`, and logs one summary line per API request.
 */
export function requestLogging(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const startedAt = process.hrtime.bigint();
    const context: RequestContext = { requestId };

    res.on('finish', () => {
      if (!req.originalUrl.startsWith('/api/')) return;
      const uid = typeof res.locals.userUid === 'string' ? res.locals.userUid : undefined;
      const route = `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`.trim();
      const latencyMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
      const severity: Severity = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARNING' : 'INFO';
      contextStore.run({ ...context, route, uid }, () => {
        write(severity, 'request', [], { status: res.statusCode, latencyMs });
      });
    });

    contextStore.run(context, next);
  };
}

/** Lets a handler record which account a request belongs to for the lines it logs. */
export function setRequestUid(uid: string) {
  const context = contextStore.getStore();
  if (context) context.uid = uid;
}
