/**
 * "캐시 비우고 다시 시작" for the top-level error screen. Only this app's keys
 * (`brake_`, `eb_`) are touched. The login session stays so the restart does
 * not ask for the PIN, and an outbox that still holds unsent changes is kept,
 * since it is the only copy of those changes.
 */
const APP_KEY_PREFIXES = ['brake_', 'eb_'];
const PRESERVED_KEYS = new Set(['eb_session_token', 'eb_session_account']);
const OUTBOX_KEY_PATTERN = /^brake_firestore_outbox(?::|$)/;

function hasPendingWrites(raw: string | null) {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return !Array.isArray(parsed) || parsed.length > 0;
  } catch {
    // Unreadable but present: treat as pending rather than risk losing it.
    return true;
  }
}

export function planCacheReset(storage: Pick<Storage, 'length' | 'key' | 'getItem'>) {
  const remove: string[] = [];
  const keptOutboxes: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !APP_KEY_PREFIXES.some(prefix => key.startsWith(prefix)) || PRESERVED_KEYS.has(key)) continue;
    if (OUTBOX_KEY_PATTERN.test(key) && hasPendingWrites(storage.getItem(key))) {
      keptOutboxes.push(key);
      continue;
    }
    remove.push(key);
  }
  return { remove, keptOutboxes };
}

export function resetAppCache(storage: Storage = localStorage) {
  const plan = planCacheReset(storage);
  plan.remove.forEach(key => storage.removeItem(key));
  return plan;
}
