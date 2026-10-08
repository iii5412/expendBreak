// Builds the Android screen bundle that the deployed server hands to installed apps.
//
//   LIVE_BUNDLE_VERSION=<commit> VITE_API_BASE_URL=https://... node scripts/build-live-bundle.mjs
//
// Output: live-update/<version>.zip and live-update/manifest.json. The Docker
// image copies that folder and src/server/routes/liveUpdate.ts serves it.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(rootDir, 'build', 'live-bundle-web');
const publishDir = join(rootDir, 'live-update');

function fail(message) {
  console.error(`\nLive bundle build stopped: ${message}\n`);
  process.exit(1);
}

const version = String(process.env.LIVE_BUNDLE_VERSION || '').trim();
if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(version)) {
  fail('LIVE_BUNDLE_VERSION must be set (letters, digits, . _ -), e.g. the commit SHA.');
}

const apiBase = String(process.env.VITE_API_BASE_URL || '').trim();
let apiOrigin;
try {
  const parsed = new URL(apiBase);
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error();
  apiOrigin = parsed.origin;
} catch {
  fail('VITE_API_BASE_URL must be the HTTPS origin of the deployed server.');
}

// The bundle may only rely on native code that the installed APK already has.
// Every native change bumps versionCode, so the current one is the minimum.
const gradle = readFileSync(join(rootDir, 'android/app/build.gradle'), 'utf8');
const minNativeBuild = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
if (!Number.isSafeInteger(minNativeBuild) || minNativeBuild < 1) fail('versionCode not found in android/app/build.gradle.');

rmSync(outDir, { recursive: true, force: true });
const build = spawnSync(process.execPath, [join(rootDir, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir'], {
  cwd: rootDir,
  env: { ...process.env, VITE_API_BASE_URL: apiOrigin, LIVE_BUNDLE_VERSION: version },
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

function collect(dir, files = {}) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, files);
    else files[relative(outDir, full).split(sep).join('/')] = readFileSync(full);
  }
  return files;
}

const files = collect(outDir);
if (!files['index.html']) fail('index.html missing from the bundle.');
// The native app never registers the web service worker (ServiceWorkerUpdater).
delete files['sw.js'];

const zip = Buffer.from(zipSync(files, { level: 9, mtime: new Date('2020-01-01T00:00:00Z') }));
const checksum = createHash('sha256').update(zip).digest('hex');

rmSync(publishDir, { recursive: true, force: true });
mkdirSync(publishDir, { recursive: true });
writeFileSync(join(publishDir, `${version}.zip`), zip);
writeFileSync(
  join(publishDir, 'manifest.json'),
  `${JSON.stringify({ version, checksum, minNativeBuild, builtAt: new Date().toISOString() }, null, 2)}\n`,
);

console.log(`\nLive bundle ${version}: ${(zip.length / 1024).toFixed(0)} KiB, needs APK build ${minNativeBuild}+, API ${apiOrigin}`);
