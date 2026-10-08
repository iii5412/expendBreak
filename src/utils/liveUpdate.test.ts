import { describe, expect, it } from 'vitest';
import { decideLiveUpdate, parseLiveBundleInfo } from './liveUpdate';

const info = {
  version: 'abc123def456',
  checksum: 'b'.repeat(64),
  minNativeBuild: 12,
  path: '/api/live-update/abc123def456.zip',
};

const state = { currentVersion: 'old000000000', nativeBuild: 12, bundles: [] };

describe('live bundle metadata', () => {
  it('accepts the manifest the server publishes', () => {
    expect(parseLiveBundleInfo(info)).toEqual(info);
  });

  it('refuses a download path pointing anywhere else', () => {
    expect(() => parseLiveBundleInfo({ ...info, path: 'https://evil.example/a.zip' })).toThrow(/경로/);
  });

  it('refuses a missing checksum', () => {
    expect(() => parseLiveBundleInfo({ ...info, checksum: '' })).toThrow(/검증 정보/);
  });
});

describe('live update decision', () => {
  it('does nothing when the app already runs that bundle', () => {
    expect(decideLiveUpdate(info, { ...state, currentVersion: info.version })).toEqual({ action: 'none', reason: 'current' });
  });

  it('waits for a new APK when the bundle needs newer native code', () => {
    expect(decideLiveUpdate(info, { ...state, nativeBuild: 11 })).toEqual({ action: 'none', reason: 'native-too-old' });
  });

  it('downloads a new compatible bundle', () => {
    expect(decideLiveUpdate(info, state)).toEqual({ action: 'download' });
  });

  it('stages an already downloaded bundle instead of downloading again', () => {
    const bundles = [{ id: 'b1', version: info.version, status: 'pending' as const }];
    expect(decideLiveUpdate(info, { ...state, bundles })).toEqual({ action: 'stage', bundleId: 'b1' });
  });

  it('never retries a bundle that failed to start', () => {
    const bundles = [{ id: 'b1', version: info.version, status: 'error' as const }];
    expect(decideLiveUpdate(info, { ...state, bundles })).toEqual({ action: 'none', reason: 'failed-before' });
  });
});

describe('applying a ready update on return', () => {
  it('applies only after a long break and only when something is ready', async () => {
    const { shouldApplyOnResume, RESUME_APPLY_AFTER_MS } = await import('./liveUpdate');
    const now = 1_000_000_000;
    expect(shouldApplyOnResume(now - RESUME_APPLY_AFTER_MS, now, true)).toBe(true);
    expect(shouldApplyOnResume(now - 60_000, now, true)).toBe(false);
    expect(shouldApplyOnResume(now - RESUME_APPLY_AFTER_MS, now, false)).toBe(false);
    expect(shouldApplyOnResume(null, now, true)).toBe(false);
  });
});
