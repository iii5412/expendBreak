import { describe, expect, it } from 'vitest';
import { apiUrl } from './api';

describe('apiUrl', () => {
  it('keeps web requests same-origin when no base URL is configured', () => {
    expect(apiUrl('/api/auth/verify-key', '')).toBe('/api/auth/verify-key');
  });

  it('joins a native HTTPS origin without duplicate slashes', () => {
    expect(apiUrl('/api/auth/verify-key', 'https://example.com/'))
      .toBe('https://example.com/api/auth/verify-key');
  });

  it('allows cleartext only for local development', () => {
    expect(apiUrl('/api/auth/status', 'http://localhost:3000'))
      .toBe('http://localhost:3000/api/auth/status');
    expect(() => apiUrl('/api/auth/status', 'http://example.com')).toThrow(/HTTPS/);
  });

  it('rejects a relative API base and malformed paths', () => {
    expect(() => apiUrl('api/auth/status', 'https://example.com')).toThrow(/start with/);
    expect(() => apiUrl('/api/auth/status', '/backend')).toThrow();
  });
});
