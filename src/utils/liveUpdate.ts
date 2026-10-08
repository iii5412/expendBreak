import { App as CapacitorApp } from '@capacitor/app';
import { CapacitorUpdater, type BundleInfo } from '@capgo/capacitor-updater';
import { apiUrl } from './api';
import { isNativeAndroid } from './platform';

/**
 * Screen updates for the installed Android app without a new APK.
 *
 * The server image carries a zip of the web bundle built for the native
 * WebView. The app downloads it in the background and switches to it only at
 * the next cold start: switching on background would reload the WebView while
 * the user is in the camera or a permission screen and lose what they typed.
 */

export interface LiveBundleInfo {
  version: string;
  checksum: string;
  minNativeBuild: number;
  path: string;
}

export type LiveUpdateDecision =
  | { action: 'none'; reason: 'current' | 'native-too-old' | 'failed-before' | 'in-progress' }
  | { action: 'download' }
  | { action: 'stage'; bundleId: string };

const PENDING_KEY = 'brake_live_update_pending';
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const PENDING_APPLY_TIMEOUT_MS = 1500;

export function currentBundleVersion(): string {
  return typeof __APP_BUILD__ === 'undefined' ? '' : __APP_BUILD__.bundleVersion;
}

export function parseLiveBundleInfo(value: unknown): LiveBundleInfo {
  if (!value || typeof value !== 'object') throw new Error('화면 업데이트 정보 형식이 올바르지 않습니다.');
  const input = value as Record<string, unknown>;
  const version = String(input.version ?? '');
  const checksum = String(input.checksum ?? '');
  const minNativeBuild = Number(input.minNativeBuild);
  const path = String(input.path ?? '');
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(version)) throw new Error('화면 업데이트 버전이 올바르지 않습니다.');
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('화면 업데이트 검증 정보가 올바르지 않습니다.');
  if (!Number.isSafeInteger(minNativeBuild) || minNativeBuild < 1) throw new Error('화면 업데이트 앱 버전 조건이 올바르지 않습니다.');
  // Only our own API path: the zip is then fetched from the configured API origin, never a URL the response chose.
  if (path !== `/api/live-update/${version}.zip`) throw new Error('화면 업데이트 경로가 올바르지 않습니다.');
  return { version, checksum, minNativeBuild, path };
}

export function decideLiveUpdate(
  info: LiveBundleInfo,
  state: { currentVersion: string; nativeBuild: number; bundles: Pick<BundleInfo, 'id' | 'version' | 'status'>[] },
): LiveUpdateDecision {
  if (info.version === state.currentVersion) return { action: 'none', reason: 'current' };
  // A bundle built against newer native plugins would call code this APK does not have.
  if (!Number.isSafeInteger(state.nativeBuild) || state.nativeBuild < info.minNativeBuild) {
    return { action: 'none', reason: 'native-too-old' };
  }
  const known = state.bundles.filter(bundle => bundle.version === info.version);
  // The updater marks a bundle as error when it failed to start; never retry the same version.
  if (known.some(bundle => bundle.status === 'error')) return { action: 'none', reason: 'failed-before' };
  const ready = known.find(bundle => bundle.status === 'pending' || bundle.status === 'success');
  if (ready) return { action: 'stage', bundleId: ready.id };
  if (known.some(bundle => bundle.status === 'downloading')) return { action: 'none', reason: 'in-progress' };
  return { action: 'download' };
}

function readPending(): { id: string; version: string } | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    return parsed && typeof parsed.id === 'string' && typeof parsed.version === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function writePending(value: { id: string; version: string } | null) {
  try {
    if (value) localStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // Without storage the bundle is found again through the updater's own list on the next check.
  }
}

/**
 * Runs before the first render. Returns true when the WebView is switching to
 * a downloaded bundle, in which case the caller must not render.
 */
export async function applyPendingLiveBundle(): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  const pending = readPending();
  if (!pending || pending.version === currentBundleVersion()) {
    if (pending) writePending(null);
    return false;
  }
  const attempt = (async () => {
    const { bundles } = await CapacitorUpdater.list();
    const bundle = bundles.find(item => item.id === pending.id);
    writePending(null);
    if (!bundle || (bundle.status !== 'pending' && bundle.status !== 'success')) return false;
    await CapacitorUpdater.set({ id: bundle.id });
    return true;
  })();
  const timeout = new Promise<boolean>(resolve => setTimeout(() => resolve(false), PENDING_APPLY_TIMEOUT_MS));
  return Promise.race([attempt.catch(() => false), timeout]);
}

let checking = false;

export async function checkLiveUpdate(): Promise<LiveUpdateDecision | null> {
  if (!isNativeAndroid() || checking) return null;
  checking = true;
  try {
    const response = await fetch(apiUrl('/api/live-update'), { cache: 'no-store' });
    if (response.status === 204 || response.status === 404) return null;
    if (!response.ok) throw new Error(`화면 업데이트 확인 실패 (${response.status})`);
    const info = parseLiveBundleInfo(await response.json());
    const [{ build }, { bundles }] = await Promise.all([CapacitorApp.getInfo(), CapacitorUpdater.list()]);
    const decision = decideLiveUpdate(info, { currentVersion: currentBundleVersion(), nativeBuild: Number(build), bundles });

    if (decision.action === 'stage') {
      writePending({ id: decision.bundleId, version: info.version });
    } else if (decision.action === 'download') {
      const bundle = await CapacitorUpdater.download({
        url: apiUrl(info.path),
        version: info.version,
        checksum: info.checksum,
      });
      writePending({ id: bundle.id, version: info.version });
    }
    return decision;
  } finally {
    checking = false;
  }
}

/**
 * Called once the app has rendered. Confirms the running bundle works (the
 * updater rolls back to the previous one if this never arrives) and starts
 * background checks on launch and on return to the app.
 */
export function startLiveUpdates(): () => void {
  if (!isNativeAndroid()) return () => undefined;
  void CapacitorUpdater.notifyAppReady().catch(() => undefined);

  let lastCheck = 0;
  const run = () => {
    if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
    lastCheck = Date.now();
    void checkLiveUpdate().catch(() => undefined);
  };
  run();
  const listener = CapacitorApp.addListener('resume', run);
  return () => {
    void listener.then(handle => handle.remove());
  };
}
