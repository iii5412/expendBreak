import express from 'express';
import path from 'path';
import { readFile } from 'node:fs/promises';
import { logger } from '../lib/logger';

export interface LiveBundleManifest {
  version: string;
  checksum: string;
  minNativeBuild: number;
  builtAt?: string;
}

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;

export function parseLiveBundleManifestFile(value: unknown): LiveBundleManifest | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const version = String(input.version ?? '');
  const checksum = String(input.checksum ?? '');
  const minNativeBuild = Number(input.minNativeBuild);
  if (!VERSION_PATTERN.test(version) || !/^[a-f0-9]{64}$/.test(checksum)) return null;
  if (!Number.isSafeInteger(minNativeBuild) || minNativeBuild < 1) return null;
  return {
    version,
    checksum,
    minNativeBuild,
    builtAt: typeof input.builtAt === 'string' ? input.builtAt : undefined,
  };
}

/**
 * Serves the Android web bundle that ships inside this server image, so a
 * deploy updates the server and the installed app's screens together.
 *
 * Unauthenticated like /api/app-update: the bundle is the same public web app,
 * and the native updater refuses any zip whose SHA-256 differs from the manifest.
 */
export function createLiveUpdateRouter({ dir = path.join(process.cwd(), 'live-update') }: { dir?: string } = {}) {
  const router = express.Router();
  let cached: LiveBundleManifest | null | undefined;

  async function loadManifest(): Promise<LiveBundleManifest | null> {
    // The image is immutable, so the first successful read is final.
    if (cached !== undefined) return cached;
    try {
      const parsed = parseLiveBundleManifestFile(JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')));
      if (!parsed) logger.error('Live update manifest is invalid; serving no bundle.');
      cached = parsed;
    } catch (error) {
      // Development and local builds have no bundle; that is not an error worth caching forever.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Live update manifest error:', error instanceof Error ? error.message : error);
      }
      return null;
    }
    return cached;
  }

  router.get('/live-update', async (_req, res) => {
    const manifest = await loadManifest();
    res.setHeader('Cache-Control', 'no-store');
    if (!manifest) return res.sendStatus(204);
    return res.json({ ...manifest, path: `/api/live-update/${manifest.version}.zip` });
  });

  router.get('/live-update/:file', async (req, res) => {
    const manifest = await loadManifest();
    if (!manifest || req.params.file !== `${manifest.version}.zip`) {
      return res.status(404).json({ message: '배포 중인 화면 업데이트가 없습니다.' });
    }
    // Versioned by content, so intermediaries may keep it.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(path.join(dir, `${manifest.version}.zip`), err => {
      if (err && !res.headersSent) res.status(404).json({ message: '화면 업데이트 파일을 찾을 수 없습니다.' });
    });
  });

  return router;
}
