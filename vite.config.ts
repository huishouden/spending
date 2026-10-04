import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { pwaApp } from '@huishouden/pwa-kit/vite';

const googleFontsCache = (urlPattern: RegExp, cacheName: string) => ({
  urlPattern,
  handler: 'CacheFirst' as const,
  options: {
    cacheName,
    expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
    cacheableResponse: { statuses: [0, 200] },
  },
});

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      pwaApp({
        // Spending's path on the suite's one site (pwa-kit docs/one-site.md).
        base: '/spending/',
        name: 'Huishouden Spending',
        shortName: 'Spending',
        description: "Where the household's money goes",
        themeColor: '#1b4332',
        backgroundColor: '#faf9f5',
        includeAssets: ['icon.svg', 'favicon.png', 'apple-touch-icon.png'],
        overrides: {
          manifest: { categories: ['finance', 'productivity', 'utilities'] },
          workbox: {
            runtimeCaching: [
              googleFontsCache(/^https:\/\/fonts\.googleapis\.com\/.*/i, 'google-fonts-cache'),
              googleFontsCache(/^https:\/\/fonts\.gstatic\.com\/.*/i, 'gstatic-fonts-cache'),
            ],
          },
          devOptions: { enabled: true, type: 'module' },
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname || '.', '.'),
      },
    },
  };
});
