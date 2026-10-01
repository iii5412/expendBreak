import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { createRulesEnvironment } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createRulesEnvironment();
});
afterAll(async () => {
  await env?.cleanup();
});

const ownerStorage = () => env.authenticatedContext('owner').storage();
const bytes = (size: number) => new Uint8Array(size).fill(1);
const upload = (path: string, size = 1024, contentType = 'image/jpeg', storage = ownerStorage()) =>
  uploadBytes(ref(storage, path), bytes(size), { contentType });

describe('receipt images', () => {
  it('accepts a JPEG named original.jpg under the owner path', async () => {
    await assertSucceeds(upload('users/owner/receipts/r1/original.jpg'));
  });

  it('rejects other file names', async () => {
    await assertFails(upload('users/owner/receipts/r1/photo.jpg'));
    await assertFails(upload('users/owner/receipts/r1/original.png'));
  });

  it('rejects a content type other than image/jpeg', async () => {
    await assertFails(upload('users/owner/receipts/r1/original.jpg', 1024, 'image/png'));
  });

  it('rejects empty files and files over 8MB, and accepts exactly 8MB', async () => {
    await assertFails(upload('users/owner/receipts/r2/original.jpg', 0));
    await assertFails(upload('users/owner/receipts/r3/original.jpg', 8 * 1024 * 1024 + 1));
    await assertSucceeds(upload('users/owner/receipts/r4/original.jpg', 8 * 1024 * 1024));
  });

  it("denies another account's folder and signed-out access", async () => {
    const wifeStorage = env.authenticatedContext('wife').storage();
    await assertFails(upload('users/owner/receipts/r5/original.jpg', 1024, 'image/jpeg', wifeStorage));
    await assertFails(upload('users/owner/receipts/r5/original.jpg', 1024, 'image/jpeg', env.unauthenticatedContext().storage()));
  });

  it('lets the owner delete a receipt but writes elsewhere are denied', async () => {
    await assertSucceeds(upload('users/owner/receipts/r6/original.jpg'));
    await assertSucceeds(deleteObject(ref(ownerStorage(), 'users/owner/receipts/r6/original.jpg')));
    await assertFails(upload('users/owner/other/file.jpg'));
  });
});
