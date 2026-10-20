/**
 * Which screen opens first after unlocking: the budget view or the classic dashboard.
 *
 * The choice is a per-device convenience, so it lives in localStorage instead of the
 * account profile and needs no change to the synced data or security rules.
 */
export type StartView = 'budget' | 'classic';

const START_VIEW_KEY = 'eb.startView';

export const DEFAULT_START_VIEW: StartView = 'budget';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getStartView(storage: ReadableStorage | null = defaultStorage()): StartView {
  try {
    return storage?.getItem(START_VIEW_KEY) === 'classic' ? 'classic' : DEFAULT_START_VIEW;
  } catch {
    return DEFAULT_START_VIEW;
  }
}

/** Returns false when the browser refuses the write (private mode, full storage). */
export function setStartView(view: StartView, storage: WritableStorage | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(START_VIEW_KEY, view);
    return true;
  } catch {
    return false;
  }
}

/**
 * An explicit `?view=` always wins so links such as "기본 화면" can open the other
 * screen once without changing the saved start screen.
 */
export function resolveView(search: string, storage: ReadableStorage | null = defaultStorage()): StartView {
  const requested = new URLSearchParams(search).get('view');
  if (requested === 'budget' || requested === 'classic') return requested;
  return getStartView(storage);
}
