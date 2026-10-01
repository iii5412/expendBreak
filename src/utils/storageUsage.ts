export interface StorageUsageEntry {
  key: string;
  kb: number;
}

/** localStorage use per app key, largest first. Characters are counted twice: browsers store UTF-16. */
export function getStorageUsage(storage: Pick<Storage, 'length' | 'key' | 'getItem'> = localStorage): StorageUsageEntry[] {
  const entries: StorageUsageEntry[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !(key.startsWith('brake_') || key.startsWith('eb_'))) continue;
    const bytes = (key.length + (storage.getItem(key)?.length ?? 0)) * 2;
    entries.push({ key, kb: Math.round((bytes / 1024) * 10) / 10 });
  }
  return entries.sort((left, right) => right.kb - left.kb);
}

export function totalStorageKb(entries: StorageUsageEntry[]): number {
  return Math.round(entries.reduce((sum, entry) => sum + entry.kb, 0) * 10) / 10;
}
