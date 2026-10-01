import express from 'express';
import path from 'path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { logger } from '../lib/logger';

export function createAppUpdateRouter() {
  const router = express.Router();
  const UPDATE_APK_PATH = process.env.APP_UPDATE_APK_PATH?.trim();
  const UPDATE_VERSION_CODE = Number(process.env.APP_UPDATE_VERSION_CODE);
  const UPDATE_VERSION_NAME = process.env.APP_UPDATE_VERSION_NAME?.trim();

  let updateHashCache: { path: string; size: number; mtimeMs: number; sha256: string } | null = null;

  async function getAppUpdateArtifact() {
    if (!UPDATE_APK_PATH || !Number.isSafeInteger(UPDATE_VERSION_CODE) || UPDATE_VERSION_CODE < 1 || !UPDATE_VERSION_NAME) {
      return null;
    }
    const apkPath = path.resolve(UPDATE_APK_PATH);
    const fileStat = await stat(apkPath);
    if (!fileStat.isFile() || fileStat.size < 1) return null;

    if (
      !updateHashCache
      || updateHashCache.path !== apkPath
      || updateHashCache.size !== fileStat.size
      || updateHashCache.mtimeMs !== fileStat.mtimeMs
    ) {
      const sha256 = await new Promise<string>((resolveHash, rejectHash) => {
        const hash = createHash('sha256');
        const input = createReadStream(apkPath);
        input.on('error', rejectHash);
        input.on('data', chunk => hash.update(chunk));
        input.on('end', () => resolveHash(hash.digest('hex')));
      });
      updateHashCache = { path: apkPath, size: fileStat.size, mtimeMs: fileStat.mtimeMs, sha256 };
    }

    return {
      apkPath,
      sizeBytes: fileStat.size,
      sha256: updateHashCache.sha256,
      versionCode: UPDATE_VERSION_CODE,
      versionName: UPDATE_VERSION_NAME,
      releaseNotes: process.env.APP_UPDATE_RELEASE_NOTES?.trim() || undefined,
    };
  }

  // APK metadata and the signed artifact are intentionally unauthenticated: the
  // native package installer verifies that updates use the same signing key, and
  // the client additionally verifies this server-provided SHA-256 before opening it.
  router.get('/app-update', async (_req, res) => {
    try {
      const artifact = await getAppUpdateArtifact();
      res.setHeader('Cache-Control', 'no-store');
      if (!artifact) return res.sendStatus(204);
      const { apkPath: _apkPath, ...metadata } = artifact;
      return res.json(metadata);
    } catch (error) {
      logger.error('App update metadata error:', error instanceof Error ? error.message : error);
      return res.sendStatus(204);
    }
  });

  router.get('/app-update/apk', async (_req, res) => {
    try {
      const artifact = await getAppUpdateArtifact();
      if (!artifact) return res.status(404).json({ message: '배포 중인 APK 업데이트가 없습니다.' });
      res.setHeader('Cache-Control', 'no-store');
      return res.download(
        artifact.apkPath,
        `expendbreak-v${artifact.versionName}-${artifact.versionCode}.apk`,
      );
    } catch (error) {
      logger.error('App update download error:', error instanceof Error ? error.message : error);
      return res.status(404).json({ message: 'APK 업데이트 파일을 찾을 수 없습니다.' });
    }
  });

  return router;
}
