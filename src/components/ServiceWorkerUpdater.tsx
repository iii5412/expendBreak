import { useEffect } from 'react';
import { useToast } from './ui/FeedbackProvider';
import { isNativeAndroid } from '../utils/platform';

/**
 * Registers the service worker and, when a newer build finishes installing,
 * offers a reload instead of silently swapping the app under the user.
 */
export const ServiceWorkerUpdater: React.FC = () => {
  const { showToast } = useToast();

  useEffect(() => {
    // Native builds ship versioned web assets inside the APK. Registering the
    // web service worker there would create a second, stale cache layer.
    if (isNativeAndroid()) return;
    // The worker is only emitted by the production build.
    if (!import.meta.env.PROD) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    let cancelled = false;

    const promptUpdate = (waiting: ServiceWorker) => {
      showToast({
        message: '새 버전이 준비되었습니다.',
        description: '새로고침하면 최신 화면으로 바뀝니다.',
        tone: 'info',
        durationMs: 0,
        action: {
          label: '새로고침',
          onAction: () => {
            waiting.postMessage('SKIP_WAITING');
            window.location.reload();
          },
        },
      });
    };

    navigator.serviceWorker.register('/sw.js').then(registration => {
      if (cancelled) return;

      if (registration.waiting && navigator.serviceWorker.controller) {
        promptUpdate(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // A newly installed worker with an existing controller means an update.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            promptUpdate(installing);
          }
        });
      });
    }).catch(error => {
      console.error('Service worker registration failed:', error);
    });

    return () => {
      cancelled = true;
    };
  }, [showToast]);

  return null;
};
