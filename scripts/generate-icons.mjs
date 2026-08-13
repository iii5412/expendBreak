/**
 * Generates the PWA app icons as PNGs with no image dependencies.
 *
 * Draws the brand mark directly into an RGBA buffer and encodes it with the
 * built-in zlib, so the icons can be regenerated on any machine that can run
 * the project (`node scripts/generate-icons.mjs`).
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT_DIR, 'public');
const ANDROID_RES_DIR = resolve(ROOT_DIR, 'android/app/src/main/res');

const BACKGROUND = [2, 6, 23]; // slate-950
const BOLT = [244, 63, 94]; // rose-500

/** Lightning bolt outline in a 0..1 unit square, matching the in-app brand icon. */
const BOLT_POLYGON = [
  [0.56, 0.06], [0.24, 0.55], [0.45, 0.55], [0.40, 0.94],
  [0.74, 0.44], [0.53, 0.44], [0.56, 0.06],
];

function isInsidePolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, pixelAt) {
  // One filter byte (0 = None) per scanline, then RGBA samples.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * `maskable` icons must fill the whole canvas because the launcher crops them;
 * the plain icon keeps rounded corners instead.
 */
function makeIcon(size, { maskable }) {
  const radius = maskable ? 0 : size * 0.22;
  const inset = maskable ? size * 0.18 : size * 0.16;
  const boltSize = size - inset * 2;

  return encodePng(size, size, (x, y) => {
    if (!maskable) {
      // Round the corners by clearing pixels outside the rounded rectangle.
      const cornerX = Math.min(x, size - 1 - x);
      const cornerY = Math.min(y, size - 1 - y);
      if (cornerX < radius && cornerY < radius) {
        const dx = radius - cornerX;
        const dy = radius - cornerY;
        if (dx * dx + dy * dy > radius * radius) return [0, 0, 0, 0];
      }
    }

    const unitX = (x - inset) / boltSize;
    const unitY = (y - inset) / boltSize;
    if (unitX >= 0 && unitX <= 1 && unitY >= 0 && unitY <= 1
      && isInsidePolygon(unitX, unitY, BOLT_POLYGON)) {
      return [...BOLT, 255];
    }
    return [...BACKGROUND, 255];
  });
}

function makeSplash(width, height) {
  const boltSize = Math.round(Math.min(width, height) * 0.28);
  const left = (width - boltSize) / 2;
  const top = (height - boltSize) / 2;

  return encodePng(width, height, (x, y) => {
    const unitX = (x - left) / boltSize;
    const unitY = (y - top) / boltSize;
    if (unitX >= 0 && unitX <= 1 && unitY >= 0 && unitY <= 1
      && isInsidePolygon(unitX, unitY, BOLT_POLYGON)) {
      return [...BOLT, 255];
    }
    return [...BACKGROUND, 255];
  });
}

function writePng(target, png, dimensions) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, png);
  console.log(`${target.replace(`${ROOT_DIR}\\`, '')}: ${dimensions}, ${png.length} bytes`);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
];

for (const [name, size, options] of targets) {
  const png = makeIcon(size, options);
  writePng(resolve(OUT_DIR, name), png, `${size}x${size}`);
}

const androidIconSizes = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

for (const [density, size] of Object.entries(androidIconSizes)) {
  const png = makeIcon(size, { maskable: true });
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
    writePng(resolve(ANDROID_RES_DIR, `mipmap-${density}`, name), png, `${size}x${size}`);
  }
}

const androidSplashes = [
  ['drawable/splash.png', 480, 320],
  ['drawable-land-mdpi/splash.png', 480, 320],
  ['drawable-land-hdpi/splash.png', 800, 480],
  ['drawable-land-xhdpi/splash.png', 1280, 720],
  ['drawable-land-xxhdpi/splash.png', 1600, 960],
  ['drawable-land-xxxhdpi/splash.png', 1920, 1280],
  ['drawable-port-mdpi/splash.png', 320, 480],
  ['drawable-port-hdpi/splash.png', 480, 800],
  ['drawable-port-xhdpi/splash.png', 720, 1280],
  ['drawable-port-xxhdpi/splash.png', 960, 1600],
  ['drawable-port-xxxhdpi/splash.png', 1280, 1920],
];

for (const [relativePath, width, height] of androidSplashes) {
  writePng(resolve(ANDROID_RES_DIR, relativePath), makeSplash(width, height), `${width}x${height}`);
}
