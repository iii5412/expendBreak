import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.iii5412.expendbreak',
  appName: '지출브레이크',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    // Self-hosted screen updates (src/utils/liveUpdate.ts). Every Capgo cloud
    // endpoint is blanked so the app never reports to or polls a third party.
    CapacitorUpdater: {
      autoUpdate: false,
      updateUrl: '',
      statsUrl: '',
      channelUrl: '',
      allowModifyUrl: false,
      // Roll back when the new bundle has not confirmed it started within 10s.
      appReadyTimeout: 10000,
      // A new APK ships its own screens; drop downloaded ones built for the old APK.
      resetWhenUpdate: true,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
    },
  },
};

export default config;
