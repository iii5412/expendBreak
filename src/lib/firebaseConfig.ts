import savedConfig from '../../firebase-applet-config.json';

/** Web SDK configuration only. Server credentials never belong in VITE_* variables. */
export const firebaseConfig = import.meta.env.VITE_FIREBASE_PROJECT_ID
  ? {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)',
    }
  : savedConfig;

if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId) {
  throw new Error('Firebase 웹 설정의 apiKey, authDomain, projectId를 확인해 주세요.');
}
