import { describe, expect, it } from 'vitest';
import { applyAppTheme, normalizeAppTheme } from './theme';

describe('account theme', () => {
  it('keeps the existing dark theme as the safe default', () => {
    expect(normalizeAppTheme(undefined)).toBe('dark');
    expect(normalizeAppTheme('unexpected')).toBe('dark');
  });

  it('applies the selected theme to the document root', () => {
    const root = { dataset: {} } as HTMLElement;
    expect(applyAppTheme('light', root)).toBe('light');
    expect(root.dataset.theme).toBe('light');
  });
});
