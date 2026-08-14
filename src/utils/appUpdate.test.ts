import { describe, expect, it } from 'vitest';
import { hasNewerAppVersion, parseAppUpdateInfo } from './appUpdate';

const validUpdate = {
  versionCode: 3,
  versionName: '1.2.0',
  sizeBytes: 12_345,
  sha256: 'a'.repeat(64),
};

describe('app update metadata', () => {
  it('accepts valid metadata and compares numeric Android version codes', () => {
    const update = parseAppUpdateInfo(validUpdate);
    expect(hasNewerAppVersion('2', update)).toBe(true);
    expect(hasNewerAppVersion('3', update)).toBe(false);
    expect(hasNewerAppVersion('10', update)).toBe(false);
  });

  it('rejects metadata without a usable checksum', () => {
    expect(() => parseAppUpdateInfo({ ...validUpdate, sha256: 'not-a-hash' })).toThrow(/검증 정보/);
  });

  it('rejects invalid version codes', () => {
    expect(() => parseAppUpdateInfo({ ...validUpdate, versionCode: 0 })).toThrow(/버전 정보/);
  });
});
