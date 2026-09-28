// Signs an account out of every device: raises sessionEpochs/{uid}.epoch so the
// API rejects older tokens (within the server's 60 s cache), and revokes the
// Firebase refresh tokens so Firestore access ends when the ID token expires (<= 1 h).
// Needs Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or gcloud auth).
import { readFileSync } from 'node:fs';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const uid = process.argv[2];
if (!uid || !/^[A-Za-z0-9._-]{1,64}$/.test(uid)) {
  console.error('Usage: npm run session:revoke -- <uid>');
  process.exit(1);
}

const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const app = initializeApp({ credential: applicationDefault(), projectId: config.projectId });
const db = config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, config.firestoreDatabaseId)
  : getFirestore(app);

const reference = db.collection('sessionEpochs').doc(uid);
const epoch = await db.runTransaction(async transaction => {
  const snapshot = await transaction.get(reference);
  const current = Number(snapshot.exists ? snapshot.get('epoch') : 0);
  const next = (Number.isSafeInteger(current) && current > 0 ? current : 0) + 1;
  transaction.set(reference, { epoch: next, revokedAt: new Date().toISOString() }, { merge: true });
  return next;
});

try {
  await getAuth(app).revokeRefreshTokens(uid);
} catch (error) {
  if (error?.code !== 'auth/user-not-found') throw error;
  console.warn(`No Firebase Auth user named ${uid}; only the API sessions were revoked.`);
}

console.log(`Revoked all sessions of ${uid} (epoch is now ${epoch}).`);
