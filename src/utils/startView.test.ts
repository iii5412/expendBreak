import { describe, expect, it } from 'vitest';
import { getStartView, resolveView, setStartView } from './startView';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('startView', () => {
  it('opens the budget view unless the classic screen was chosen', () => {
    expect(getStartView(memoryStorage())).toBe('budget');
    expect(getStartView(memoryStorage({ 'eb.startView': 'garbage' }))).toBe('budget');
    expect(getStartView(memoryStorage({ 'eb.startView': 'classic' }))).toBe('classic');
    expect(getStartView(null)).toBe('budget');
  });

  it('stores the choice and reports a refused write', () => {
    const storage = memoryStorage();
    expect(setStartView('classic', storage)).toBe(true);
    expect(getStartView(storage)).toBe('classic');
    expect(setStartView('classic', null)).toBe(false);
    expect(
      setStartView('budget', {
        setItem: () => {
          throw new Error('quota');
        },
      }),
    ).toBe(false);
  });

  it('lets an explicit view parameter override the saved choice', () => {
    const classic = memoryStorage({ 'eb.startView': 'classic' });
    expect(resolveView('', classic)).toBe('classic');
    expect(resolveView('?view=budget', classic)).toBe('budget');
    expect(resolveView('?view=classic', memoryStorage())).toBe('classic');
    expect(resolveView('?view=other', memoryStorage())).toBe('budget');
  });
});
