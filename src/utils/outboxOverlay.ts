/**
 * Puts changes that are still waiting in the outbox back on top of a snapshot.
 *
 * A Firestore snapshot describes the server's state, and the local cache used
 * to be replaced by it wholesale. A change the server has not accepted yet —
 * queued while offline, or failed and waiting for a retry — would therefore
 * disappear from the screen while still sitting in the outbox. Overlaying the
 * outbox keeps what the user entered visible until the server confirms it.
 */

export interface OverlayEntry {
  operation: 'set' | 'delete' | 'conditional';
  collectionName: string;
  documentId: string;
  data?: Record<string, unknown>;
  merge?: boolean;
  documents?: Array<{
    collectionName: string;
    documentId: string;
    data?: Record<string, unknown>;
    remove?: boolean;
  }>;
}

export interface DocumentChange {
  kind: 'set' | 'delete';
  id: string;
  data?: Record<string, unknown>;
  merge?: boolean;
}

/** The pending changes for one collection, oldest first (the outbox is already in queue order). */
export function pendingChangesFor(collectionName: string, outbox: OverlayEntry[]): DocumentChange[] {
  const changes: DocumentChange[] = [];
  for (const entry of outbox) {
    if (entry.operation === 'conditional') {
      for (const document of entry.documents || []) {
        if (document.collectionName !== collectionName) continue;
        changes.push(document.remove
          ? { kind: 'delete', id: document.documentId }
          : { kind: 'set', id: document.documentId, data: document.data });
      }
    } else if (entry.collectionName === collectionName) {
      changes.push(entry.operation === 'delete'
        ? { kind: 'delete', id: entry.documentId }
        : { kind: 'set', id: entry.documentId, data: entry.data, merge: entry.merge });
    }
  }
  return changes;
}

function applySet<T>(existing: T | undefined, change: DocumentChange): T {
  const data = (change.data || {}) as Record<string, unknown>;
  return (change.merge && existing ? { ...existing, ...data } : data) as T;
}

/** Overlay for a collection stored as an array of `{ id, ... }` documents. */
export function overlayList<T extends { id: string }>(items: T[], changes: DocumentChange[]): T[] {
  if (changes.length === 0) return items;
  const byId = new Map(items.map(item => [item.id, item]));
  for (const change of changes) {
    if (change.kind === 'delete') {
      byId.delete(change.id);
    } else {
      byId.set(change.id, { ...applySet(byId.get(change.id), change), id: change.id } as T);
    }
  }
  return [...byId.values()];
}

/** Overlay for a collection stored as a map keyed by something derived from the document. */
export function overlayMap<T>(
  map: Record<string, T>,
  changes: DocumentChange[],
  keyOf: (id: string, data?: Record<string, unknown>) => string,
  normalize: (value: T) => T = value => value,
): Record<string, T> {
  if (changes.length === 0) return map;
  const next = { ...map };
  for (const change of changes) {
    const key = keyOf(change.id, change.data);
    if (change.kind === 'delete') delete next[key];
    else next[key] = normalize(applySet(next[key], change));
  }
  return next;
}

/** Overlay for a single document; null means it does not exist. */
export function overlayDocument<T extends Record<string, unknown>>(base: T | null, changes: DocumentChange[]): T | null {
  let current = base;
  for (const change of changes) {
    if (change.kind === 'delete') current = null;
    else current = applySet(current ?? undefined, change);
  }
  return current;
}
