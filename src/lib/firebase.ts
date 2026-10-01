import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);

// Cloud Storage (receipt images, utils/receiptStorage.ts) and Firestore (lib/firestore.ts)
// are loaded on demand and stay out of the first-screen bundle.
