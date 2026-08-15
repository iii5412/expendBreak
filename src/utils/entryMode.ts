/**
 * Remembers which input mode the add-transaction modal was last used in.
 *
 * Uses localStorage, not sessionStorage: this is a preference, not data. Someone
 * who only ever types expenses by hand should not have to leave the voice tab on
 * every single open, including the first one after a restart.
 */
import { getAccountStorageKey } from './auth';

const entryModeKey = () => getAccountStorageKey('brake_entry_mode');

export type EntryMode = 'receipt' | 'voice' | 'ai' | 'manual';

const ENTRY_MODES: EntryMode[] = ['receipt', 'voice', 'ai', 'manual'];

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function savePreferredEntryMode(mode: EntryMode) {
  try {
    store()?.setItem(entryModeKey(), mode);
  } catch {
    // Private-mode storage failures only cost us the preference.
  }
}

/**
 * Resolves the mode to open in. Falls back to `manual` whenever AI is off; the
 * other modes remain visible as opt-in entry points for the current account.
 */
export function readPreferredEntryMode(aiClassificationEnabled: boolean): EntryMode {
  if (!aiClassificationEnabled) return 'manual';
  const raw = store()?.getItem(entryModeKey());
  return ENTRY_MODES.includes(raw as EntryMode) ? raw as EntryMode : 'voice';
}
