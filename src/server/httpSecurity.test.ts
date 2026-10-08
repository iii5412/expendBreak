import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { applySecurityBaseline, largeJsonBody, resolveTrustProxyHops } from './httpSecurity';
import { listen } from './testServer';

let running: Awaited<ReturnType<typeof listen>> | null = null;
afterEach(async () => {
  await running?.close();
  running = null;
});

async function start(production: boolean) {
  const app = express();
  applySecurityBaseline(app, { production, trustProxyHops: 1 });
  app.post('/api/auth/verify-key', (req, res) => res.json({ size: JSON.stringify(req.body).length }));
  app.post('/api/ai/finance-chat', (req, res) => res.json({ size: String(req.body?.message || '').length }));
  app.post('/api/ai/receipt', largeJsonBody, (req, res) => res.json({ size: String(req.body?.image || '').length }));
  app.post('/api/ai/voice', largeJsonBody, (req, res) => res.json({ size: String(req.body?.audio || '').length }));
  app.get('/api/whoami', (req, res) => res.json({ ip: req.ip }));
  running = await listen(app);
  return running;
}

const post = (url: string, body: unknown) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('request body limits', () => {
  it('rejects a 200KB body on the unauthenticated PIN endpoint with 413', async () => {
    const server = await start(true);
    const response = await post(server.url('/api/auth/verify-key'), { key: '1'.repeat(200 * 1024) });
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('accepts ordinary small JSON bodies', async () => {
    const server = await start(true);
    const response = await post(server.url('/api/auth/verify-key'), { key: '123456' });
    expect(response.status).toBe(200);
  });

  it('accepts a long finance-chat prompt without raising the default limit globally', async () => {
    const server = await start(true);
    const message = '가'.repeat(64_000);
    const response = await post(server.url('/api/ai/finance-chat'), { message });
    expect(response.status).toBe(200);
    expect((await response.json()).size).toBe(message.length);
  });

  it('still accepts a 5MB receipt image and voice payload on their own routes', async () => {
    const server = await start(true);
    const image = 'a'.repeat(5 * 1024 * 1024);
    const receipt = await post(server.url('/api/ai/receipt'), { image });
    expect(receipt.status).toBe(200);
    expect((await receipt.json()).size).toBe(image.length);
    const voice = await post(server.url('/api/ai/voice'), { audio: image });
    expect(voice.status).toBe(200);
  });

  it('rejects receipt payloads above 12MB', async () => {
    const server = await start(true);
    const response = await post(server.url('/api/ai/receipt'), { image: 'a'.repeat(13 * 1024 * 1024) });
    expect(response.status).toBe(413);
  });
});

describe('security headers', () => {
  it('hides X-Powered-By and sets nosniff and referrer policy', async () => {
    const server = await start(true);
    const response = await fetch(server.url('/api/whoami'));
    expect(response.headers.get('x-powered-by')).toBeNull();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
  });

  it('sends HSTS and a report-only CSP in production', async () => {
    const server = await start(true);
    const response = await fetch(server.url('/api/whoami'));
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(response.headers.get('content-security-policy-report-only')).toBeTruthy();
    expect(response.headers.get('content-security-policy')).toBeNull();
  });

  it('does not send HSTS in development', async () => {
    const server = await start(false);
    const response = await fetch(server.url('/api/whoami'));
    expect(response.headers.get('strict-transport-security')).toBeNull();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('proxy trust', () => {
  it('reads the client IP from X-Forwarded-For behind one proxy hop', async () => {
    const server = await start(true);
    const response = await fetch(server.url('/api/whoami'), { headers: { 'X-Forwarded-For': '203.0.113.7' } });
    expect((await response.json()).ip).toBe('203.0.113.7');
  });

  it('only trusts the last hop, so a spoofed leading entry is ignored', async () => {
    const server = await start(true);
    const response = await fetch(server.url('/api/whoami'), {
      headers: { 'X-Forwarded-For': '6.6.6.6, 203.0.113.7' },
    });
    expect((await response.json()).ip).toBe('203.0.113.7');
  });

  it('defaults TRUST_PROXY_HOPS to 1 and honours an explicit value', () => {
    expect(resolveTrustProxyHops({})).toBe(1);
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '2' })).toBe(2);
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '0' })).toBe(0);
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: 'x' })).toBe(1);
  });
});
