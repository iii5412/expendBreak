import { describe, expect, it } from 'vitest';
import { loadServerConfig } from './config';

describe('Cloud Run port configuration', () => {
  it('defaults production to 8080 and preserves the local development port', () => {
    expect(loadServerConfig({ NODE_ENV: 'production' }).port).toBe(8080);
    expect(loadServerConfig({}).port).toBe(3000);
  });
  it('uses the platform-supplied PORT', () => {
    expect(loadServerConfig({ NODE_ENV: 'production', PORT: '9090' }).port).toBe(9090);
  });
});
