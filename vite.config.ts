import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: [
          'icon.svg',
          'icon-kids.svg',
          'icon-adult.svg',
          'icon-christmas.svg',
          'apple-touch-icon.png',
        ],
        manifest: {
          id: '/',
          name: 'XEROTV',
          short_name: 'XEROTV',
          description:
            'Liquid Glass movie and series streaming platform developed by XIAN IN PRODUCTION with offline downloads and real TMDB sync.',
          theme_color: '#0a0a0c',
          background_color: '#0a0a0c',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          shortcuts: [
            {
              name: 'Offline Vault',
              short_name: 'Vault',
              description: 'Watch downloaded movies without internet',
              url: '/?section=vault',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }],
            },
            {
              name: 'Movies Catalog',
              short_name: 'Movies',
              description: 'Browse streaming movies on XEROTV',
              url: '/?section=movies',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }],
            },
            {
              name: 'Docs & Improving 1.0',
              short_name: 'Docs 1.0',
              description: 'Read docs and watch Improving at 1.0',
              url: '/?section=docs',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }],
            },
            {
              name: 'Get Mobile App',
              short_name: 'Get App',
              description: 'Install WebApp shortcut or download Android APK',
              url: '/?section=apps',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }],
            },
          ],
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          navigateFallbackDenylist: [/^\/api\//, /^\/apps\//, /^\/media\//],
          runtimeCaching: [
            {
              urlPattern: ({ url }) =>
                url.pathname.startsWith('/api/download/') ||
                url.pathname.startsWith('/api/admin/') ||
                url.pathname.startsWith('/api/apps/') ||
                url.pathname.startsWith('/api/speedtest/') ||
                url.pathname.startsWith('/api/security/'),
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/image\.tmdb\.org\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'tmdb-images-cache',
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 14,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
          type: 'module',
        },
      }),
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const rootDir = import.meta.dirname;
          const distDir = path.resolve(rootDir, 'dist');
          const srcAssets = path.resolve(rootDir, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    build: {
      chunkSizeWarningLimit: 500,
      rolldownOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/@firebase/firestore') || id.includes('node_modules/firebase/firestore')) {
              return 'vendor-firebase-firestore';
            }
            if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
              return 'vendor-firebase';
            }
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'vendor-react';
            }
            if (id.includes('node_modules/motion') || id.includes('node_modules/lucide-react')) {
              return 'vendor-ui';
            }
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
