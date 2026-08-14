import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { apiUrl } from './api';

export interface AppUpdateInfo {
  versionCode: number;
  versionName: string;
  sizeBytes: number;
  sha256: string;
  releaseNotes?: string;
}

interface InstallResult {
  started: boolean;
  permissionRequired?: boolean;
}

interface DownloadProgress {
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
}

interface AppUpdaterPlugin {
  downloadAndInstall(options: { url: string; sha256: string }): Promise<InstallResult>;
  addListener(
    eventName: 'downloadProgress',
    listener: (progress: DownloadProgress) => void,
  ): Promise<PluginListenerHandle>;
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

export function parseAppUpdateInfo(value: unknown): AppUpdateInfo {
  if (!value || typeof value !== 'object') throw new Error('업데이트 정보 형식이 올바르지 않습니다.');
  const input = value as Record<string, unknown>;
  const versionCode = Number(input.versionCode);
  const sizeBytes = Number(input.sizeBytes);
  const versionName = String(input.versionName || '').trim();
  const sha256 = String(input.sha256 || '').trim().toLowerCase();

  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || !versionName) {
    throw new Error('업데이트 버전 정보가 올바르지 않습니다.');
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('업데이트 파일 검증 정보가 올바르지 않습니다.');
  }

  return {
    versionCode,
    versionName,
    sizeBytes,
    sha256,
    releaseNotes: typeof input.releaseNotes === 'string' ? input.releaseNotes.trim() || undefined : undefined,
  };
}

export function hasNewerAppVersion(installedBuild: string | number, update: AppUpdateInfo): boolean {
  const installedCode = Number(installedBuild);
  return Number.isSafeInteger(installedCode) && update.versionCode > installedCode;
}

export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  const response = await fetch(apiUrl('/api/app-update'), { cache: 'no-store' });
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) throw new Error(`업데이트 확인 실패 (${response.status})`);
  return parseAppUpdateInfo(await response.json());
}

export async function downloadAndInstallAppUpdate(
  update: AppUpdateInfo,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<InstallResult> {
  const listener = onProgress
    ? await AppUpdater.addListener('downloadProgress', onProgress)
    : null;
  try {
    return await AppUpdater.downloadAndInstall({
      url: apiUrl('/api/app-update/apk'),
      sha256: update.sha256,
    });
  } finally {
    await listener?.remove();
  }
}

export function formatUpdateSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
