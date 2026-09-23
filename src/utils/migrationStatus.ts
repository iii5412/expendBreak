/**
 * The server copied the legacy data but could not verify the copy. The app
 * must stop here: showing or writing data now could build on an incomplete copy.
 */
export class LegacyMigrationFailedError extends Error {
  constructor(message: string, readonly failure: unknown) {
    super(message);
    this.name = 'LegacyMigrationFailedError';
  }
}

export async function readMigrationResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const payload = await response.json().catch(() => ({}));
  const message = payload.message || '기존 운영 데이터 확인에 실패했습니다.';
  if (payload.error === 'Migration failed') throw new LegacyMigrationFailedError(message, payload.failure);
  throw new Error(message);
}
