import { Capacitor, registerPlugin } from '@capacitor/core';

type PermissionState = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';

interface MicrophonePermissionPlugin {
  checkPermissions(): Promise<{ microphone?: PermissionState }>;
  requestPermissions(): Promise<{ microphone?: PermissionState }>;
  openSettings(): Promise<void>;
}

const MicrophonePermission = registerPlugin<MicrophonePermissionPlugin>('MicrophonePermission');

export type MicrophoneAccessResult = 'granted' | 'settings-required';

export function isNativeMicrophonePlatform() {
  return Capacitor.isNativePlatform();
}

/**
 * Capacitor's WebView still needs Android's native RECORD_AUDIO grant before
 * getUserMedia can open the microphone. Browsers keep their normal permission
 * prompt, while Android gets an explicit in-context runtime request.
 */
export async function ensureMicrophoneAccess(): Promise<MicrophoneAccessResult> {
  if (!isNativeMicrophonePlatform()) return 'granted';

  const current = await MicrophonePermission.checkPermissions();
  if (current.microphone === 'granted') return 'granted';
  if (current.microphone === 'denied') return 'settings-required';

  const requested = await MicrophonePermission.requestPermissions();
  return requested.microphone === 'granted' ? 'granted' : 'settings-required';
}

export async function openMicrophoneSettings() {
  if (!isNativeMicrophonePlatform()) return;
  await MicrophonePermission.openSettings();
}
