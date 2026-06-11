import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Mobile-first PWA for the ONGC rotation system.
// See SPEC.md §2 (tech stack) and §5 (modules).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon-180.png'],
      manifest: {
        name: 'ONGC Rotation System',
        short_name: 'ONGC Rotation',
        description: 'Offshore workforce rotation, replacement and penalty tracking.',
        theme_color: '#0b3d5c',
        background_color: '#0b3d5c',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          // SVG kept as a scalable fallback for browsers that prefer it.
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Precache the app shell; SPA fallback for client-side routes.
        navigateFallback: '/index.html',
        // Read-only offline: cache successful Supabase GETs and serve them when
        // offline (roster, employee list, etc. keep their last-seen data).
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 300, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
})
