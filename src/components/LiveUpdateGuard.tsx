import { useEffect } from 'react';
import { startLiveUpdates } from '../utils/liveUpdate';

/**
 * Mounted beside the app inside the app-level error boundary: if the app fails
 * to render, this never mounts, the updater never hears "ready", and it rolls
 * back to the previous bundle on its own.
 */
export const LiveUpdateGuard: React.FC = () => {
  useEffect(() => startLiveUpdates(), []);
  return null;
};
