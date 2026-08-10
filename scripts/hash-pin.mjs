import { pbkdf2Sync, randomBytes } from 'node:crypto';

const pin = process.argv[2];

if (!pin || !/^\d{4,12}$/.test(pin)) {
  console.error('Usage: npm run pin:hash -- <4-12 digit PIN>');
  process.exit(1);
}

const iterations = 210_000;
const salt = randomBytes(16);
const digest = pbkdf2Sync(pin, salt, iterations, 32, 'sha256');

console.log(`pbkdf2$${iterations}$${salt.toString('base64')}$${digest.toString('base64')}`);
