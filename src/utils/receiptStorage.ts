import { firebaseApp } from '../lib/firebase';
import { getSignedInAccount } from './auth';

/**
 * Cloud Storage is only needed on the receipt screens, so its code is fetched
 * the first time one of them needs it instead of with the first screen. A
 * failed fetch (offline) is not cached, so the next attempt tries again.
 */
let storageApi: Promise<{ api: typeof import('firebase/storage'); storage: import('firebase/storage').FirebaseStorage }> | null = null;

function loadStorage() {
  storageApi ??= import('firebase/storage')
    .then(api => ({ api, storage: api.getStorage(firebaseApp) }))
    .catch(error => {
      storageApi = null;
      throw error;
    });
  return storageApi;
}

function requireOwnerUid() {
  return getSignedInAccount().uid;
}

function requireOwnedStoragePath(storagePath: string) {
  const uid = requireOwnerUid();
  if (!storagePath.startsWith(`users/${uid}/receipts/`)) {
    throw new Error('다른 계정의 영수증 파일에는 접근할 수 없습니다.');
  }
}

export async function uploadReceiptImage(receiptId: string, blob: Blob) {
  const uid = requireOwnerUid();
  const storagePath = `users/${uid}/receipts/${receiptId}/original.jpg`;
  const { api, storage } = await loadStorage();
  const storageRef = api.ref(storage, storagePath);

  const timeoutMs = 4000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Firebase Storage upload timeout')), timeoutMs);
  });

  try {
    await Promise.race([
      api.uploadBytes(storageRef, blob, {
        contentType: 'image/jpeg',
        customMetadata: { ownerUid: uid, receiptId },
      }),
      timeoutPromise,
    ]);
    return storagePath;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function loadReceiptImage(storagePath: string) {
  requireOwnedStoragePath(storagePath);
  // Loaded before the timer starts, so fetching the code is not counted as a slow download.
  const { api, storage } = await loadStorage();
  const timeoutMs = 5000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Firebase Storage download timeout')), timeoutMs);
  });

  try {
    const blob = await Promise.race([
      api.getBlob(api.ref(storage, storagePath), 8 * 1024 * 1024),
      timeoutPromise,
    ]);
    return URL.createObjectURL(blob);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function deleteReceiptImage(storagePath?: string | null) {
  if (!storagePath) return;
  requireOwnedStoragePath(storagePath);
  const { api, storage } = await loadStorage();
  try {
    await api.deleteObject(api.ref(storage, storagePath));
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== 'storage/object-not-found') throw error;
  }
}

export async function clearAllReceiptImages() {
  const uid = requireOwnerUid();
  const { api, storage } = await loadStorage();
  const rootRef = api.ref(storage, `users/${uid}/receipts`);
  let pageToken: string | undefined;
  do {
    const page = await api.list(rootRef, { maxResults: 100, pageToken });
    for (const receiptFolder of page.prefixes) {
      const files = await api.list(receiptFolder, { maxResults: 100 });
      await Promise.all(files.items.map(fileRef => api.deleteObject(fileRef)));
    }
    await Promise.all(page.items.map(fileRef => api.deleteObject(fileRef)));
    pageToken = page.nextPageToken;
  } while (pageToken);
}
