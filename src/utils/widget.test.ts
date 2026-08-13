import { describe, expect, it } from 'vitest';
import { buildWidgetSnapshot, normalizeWidgetPrivacyMode, parseNativeDestination } from './widget';

const summary = {
  remainingAllowance: 1_020_000.4,
  confirmedVariableExpenses: 299_999.6,
  spendableLimit: 1_320_000,
  dailySafeAllowance: 35_172.2,
  daysRemaining: 29,
  alertLevel: 'safe' as const,
};

describe('widget snapshot', () => {
  it('publishes only the minimum rounded summary with an idle expiry', () => {
    const now = new Date('2026-08-13T03:00:00.000Z');
    expect(buildWidgetSnapshot('2026-08', '2026-09-09', summary, {
      idleLockMinutes: 30,
      widgetPrivacyMode: 'unlock_required',
    }, now)).toEqual({
      schemaVersion: 1,
      periodYM: '2026-08',
      periodEndDate: '2026-09-09',
      remainingAllowance: 1_020_000,
      confirmedVariableExpenses: 300_000,
      spendableLimit: 1_320_000,
      dailySafeAllowance: 35_172,
      daysRemaining: 29,
      alertLevel: 'safe',
      calculatedAt: '2026-08-13T03:00:00.000Z',
      visibleUntil: '2026-08-13T03:30:00.000Z',
      privacyMode: 'unlock_required',
    });
  });

  it('does not expire explicit always-show widgets', () => {
    const snapshot = buildWidgetSnapshot('2026-08', '2026-09-09', summary, {
      idleLockMinutes: 30,
      widgetPrivacyMode: 'always_show',
    }, new Date('2026-08-13T03:00:00.000Z'));
    expect(snapshot.visibleUntil).toBeNull();
  });

  it('defaults unknown privacy values to unlock-required', () => {
    expect(normalizeWidgetPrivacyMode(undefined)).toBe('unlock_required');
    expect(normalizeWidgetPrivacyMode('unexpected')).toBe('unlock_required');
  });
});
describe('native widget destinations', () => {
  it.each([
    ['expendbreak://home', 'home'],
    ['expendbreak://transaction/new', 'transaction/new'],
    ['expendbreak://settings/widget', 'settings/widget'],
  ])('parses %s', (url, expected) => {
    expect(parseNativeDestination(url)).toBe(expected);
  });

  it('rejects external and mutating destinations', () => {
    expect(parseNativeDestination('https://example.com')).toBeNull();
    expect(parseNativeDestination('expendbreak://transaction/delete/1')).toBeNull();
  });
});
