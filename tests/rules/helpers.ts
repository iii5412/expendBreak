import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setLogLevel } from 'firebase/firestore';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

const root = resolve(__dirname, '../..');

/**
 * Connects to the emulators started by `firebase emulators:exec` (which sets
 * FIRESTORE_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST) and loads the real
 * rule files, so the tests always judge what would be deployed.
 */
// Denied writes are the point of these tests; the SDK would log each one as an error.
setLogLevel('silent');

export async function createRulesEnvironment(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: 'demo-expendbreak-rules',
    firestore: { rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8') },
    storage: { rules: readFileSync(resolve(root, 'storage.rules'), 'utf8') },
  });
}
