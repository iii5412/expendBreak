import { describe, expect, it } from 'vitest';
import { LegacyMigrationFailedError, readMigrationResponse } from './migrationStatus';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('readMigrationResponse', () => {
  it('resolves for a completed migration', async () => {
    await expect(readMigrationResponse(json(200, { ok: true, report: { version: 'legacy-root-v1' } }))).resolves.toBeUndefined();
  });

  it('resolves for a skipped migration so development keeps working', async () => {
    await expect(readMigrationResponse(json(200, { ok: true, report: { skipped: true } }))).resolves.toBeUndefined();
  });

  it('raises a dedicated error for a failed legacy migration verification', async () => {
    const error = await readMigrationResponse(json(500, {
      error: 'Migration failed',
      message: '기존 데이터 복사 검증에 실패했습니다.',
      failure: { collection: 'transactions', reason: 'amount_mismatch' },
    })).catch(caught => caught);
    expect(error).toBeInstanceOf(LegacyMigrationFailedError);
    expect(error.failure).toEqual({ collection: 'transactions', reason: 'amount_mismatch' });
  });

  it('keeps ordinary failures as generic errors so they follow the existing retry path', async () => {
    const error = await readMigrationResponse(json(401, { error: 'Unauthorized' })).catch(caught => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(LegacyMigrationFailedError);
  });

  it('survives a non-JSON error body', async () => {
    const error = await readMigrationResponse(new Response('<html>', { status: 502 })).catch(caught => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(LegacyMigrationFailedError);
  });
});
