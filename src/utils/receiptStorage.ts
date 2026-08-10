import { deleteObject, getBlob, list, ref, uploadBytes } from 'firebase/storage';
import { auth, receiptStorage } from '../lib/firebase';

function requireOwnerUid() {
  return 'owner';
}

export async function uploadReceiptImage(receiptId: string, blob: Blob) {
  const uid = requireOwnerUid();
  const storagePath = `users/${uid}/receipts/${receiptId}/original.jpg`;
  const storageRef = ref(receiptStorage, storagePath);

  const timeoutMs = 4000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Firebase Storage upload timeout')), timeoutMs);
  });

  try {
    await Promise.race([
      uploadBytes(storageRef, blob, {
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
  requireOwnerUid();
  const timeoutMs = 5000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Firebase Storage download timeout')), timeoutMs);
  });

  try {
    const blob = await Promise.race([
      getBlob(ref(receiptStorage, storagePath), 8 * 1024 * 1024),
      timeoutPromise,
    ]);
    return URL.createObjectURL(blob);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function deleteReceiptImage(storagePath?: string | null) {
  if (!storagePath) return;
  requireOwnerUid();
  try {
    await deleteObject(ref(receiptStorage, storagePath));
  } catch (error: any) {
    if (error?.code !== 'storage/object-not-found') throw error;
  }
}

export async function clearAllReceiptImages() {
  const uid = requireOwnerUid();
  const rootRef = ref(receiptStorage, `users/${uid}/receipts`);
  let pageToken: string | undefined;
  do {
    const page = await list(rootRef, { maxResults: 100, pageToken });
    for (const receiptFolder of page.prefixes) {
      const files = await list(receiptFolder, { maxResults: 100 });
      await Promise.all(files.items.map(fileRef => deleteObject(fileRef)));
    }
    await Promise.all(page.items.map(fileRef => deleteObject(fileRef)));
    pageToken = page.nextPageToken;
  } while (pageToken);
}
