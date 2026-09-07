import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { getSyncState } from './syncStatus';
export async function getDiagnosticRuntime() {
  const installed = Capacitor.isNativePlatform() ? await App.getInfo().catch(() => null) : null;
  const sync = getSyncState();
  return {
    platform: Capacitor.getPlatform(),
    installedVersion: installed?.version ?? null,
    installedBuild: installed?.build ?? null,
    webBuild: typeof __APP_BUILD__ === 'undefined' ? null : __APP_BUILD__,
    sync: { phase: sync.phase, pendingCount: sync.pendingCount, isOnline: sync.isOnline, lastSyncedAt: sync.lastSyncedAt },
  };
}
