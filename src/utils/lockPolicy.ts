/** Idle-lock options offered in settings. 0 disables the idle lock entirely. */
export const IDLE_LOCK_OPTIONS = [5, 15, 30, 60, 0] as const;

export const DEFAULT_IDLE_LOCK_MINUTES = 30;

export function normalizeIdleLockMinutes(value?: number | null): number {
  // Guard before coercion: Number(null) is 0, which would read as "lock disabled"
  // for every profile saved before this setting existed.
  if (value === null || value === undefined) return DEFAULT_IDLE_LOCK_MINUTES;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_IDLE_LOCK_MINUTES;
  return (IDLE_LOCK_OPTIONS as readonly number[]).includes(parsed)
    ? parsed
    : DEFAULT_IDLE_LOCK_MINUTES;
}

export function describeIdleLockMinutes(value: number): string {
  return value === 0 ? '사용 안 함' : value >= 60 ? `${value / 60}시간` : `${value}분`;
}
