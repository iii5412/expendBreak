import { pbkdf2Sync, randomBytes } from 'node:crypto';

const [uid, name, pin] = process.argv.slice(2);

if (!uid || !/^[A-Za-z0-9._-]{1,64}$/.test(uid) || !name || !pin || !/^\d{4,12}$/.test(pin)) {
  console.error('Usage: npm run account:hash -- <uid> <name> <4-12 digit PIN>');
  process.exit(1);
}

const iterations = 210_000;
const salt = randomBytes(16);
const digest = pbkdf2Sync(pin, salt, iterations, 32, 'sha256');
const pinHash = `pbkdf2$${iterations}$${salt.toString('base64')}$${digest.toString('base64')}`;

console.log(JSON.stringify([{ uid, name, pinHash }]));
