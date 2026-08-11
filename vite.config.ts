import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

/**
 * Emits the service worker at build time with a per-build cache name, so a new
 * deploy always invalidates the previous shell instead of serving stale assets.
 *
 * Financial data is never cached: `/api/` requests bypass the worker entirely
 * and only same-origin GETs for the app shell and hashed assets are stored.
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'expendbreak-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const version = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      // Precache every emitted chunk: the app is code-split, so caching only the
      // entry chunk leaves it unable to boot offline.
      const buildAssets = Object.keys(bundle)
        .filter(name => /\.(js|css)$/.test(name))
        .map(name => `/${name}`);
      const shell = [
        '/',
        '/manifest.webmanifest',
        '/icon-192.png',
        '/icon-512.png',
        ...buildAssets,
      ];

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const VERSION = '${version}';
const CACHE = 'expendbreak-' + VERSION;
const SHELL = ${JSON.stringify(shell)};

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).catch(() => undefined));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API traffic: it carries account data and auth-scoped responses.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put('/', response.clone());
        return response;
      } catch (error) {
        const cached = await caches.match('/');
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  // Built assets carry a content hash in the filename, so cache-first is safe.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw error;
    }
  })());
});
`,
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), serviceWorkerPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('firebase')) return 'firebase';
            if (id.includes('recharts') || id.includes('d3-')) return 'charts';
            if (id.includes('react') || id.includes('motion')) return 'react-vendor';
          },
        },
      },
    },
  };
});
