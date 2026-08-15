import { AppTheme } from '../types';

export function normalizeAppTheme(value: unknown): AppTheme {
  return value === 'light' ? 'light' : 'dark';
}

export function applyAppTheme(value: unknown, root: HTMLElement = document.documentElement): AppTheme {
  const theme = normalizeAppTheme(value);
  root.dataset.theme = theme;

  if (typeof document !== 'undefined') {
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    themeColor?.setAttribute('content', theme === 'light' ? '#f8fafc' : '#020617');
  }
  return theme;
}
