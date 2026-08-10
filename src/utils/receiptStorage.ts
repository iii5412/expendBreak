import { deleteObject, getBlob, list, ref, uploadBytes } from 'firebase/storage';
import { auth, receiptStorage } from '../lib/firebase';

function requireOwnerUid() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('PIN 로그인 후에만 영수증을 저장할 수 있습니다.');
  return uid;
}

export async function uploadReceiptImage(receiptId: string, blob: Blob) {
  const uid = requireOwnerUid();
  const storagePath = `users/${uid}/receipts/${receiptId}/original.jpg`;
  const storageRef = ref(receiptStorage, storagePath);
  await uploadBytes(storageRef, blob, {
    contentType: 'image/jpeg',
    customMetadata: { ownerUid: uid, receiptId },
  });
  return storagePath;
}

export async function loadReceiptImage(storagePath: string) {
  requireOwnerUid();
  const blob = await getBlob(ref(receiptStorage, storagePath), 8 * 1024 * 1024);
  return URL.createObjectURL(blob);
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
