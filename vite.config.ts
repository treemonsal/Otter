import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  base: '/Otter/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icons/*.png'],
      manifest: {
        name: 'Murmur · Gesprächsnotizen',
        short_name: 'Murmur',
        lang: 'de',
        description: 'Dein privates Gesprächsnotizbuch',
        theme_color: '#111315',
        background_color: '#111315',
        display: 'standalone',
        start_url: '/Otter/',
        scope: '/Otter/',
        icons: [192, 512].map((size) => ({
          src: `icons/icon-${size}.png`,
          sizes: `${size}x${size}`,
          type: 'image/png',
          purpose: 'any maskable',
        })),
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 32000000,
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,ico,wasm}'],
        // Model files are stored by Transformers.js in its own browser cache after consent.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        globIgnores: ['assets/*.wasm'],
      },
    }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
