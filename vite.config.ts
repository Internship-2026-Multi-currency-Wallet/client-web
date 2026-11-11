import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';
import { brand } from './src/brand/brand.ts';

// Static HTML and the web manifest take their values from `brand`, not from hard-coded text.
function brandPlugin(): Plugin {
  const manifest = JSON.stringify({
    name: brand.siteName,
    short_name: brand.siteName,
    icons: [{ src: brand.faviconUrl, type: 'image/svg+xml', sizes: 'any' }],
    theme_color: brand.palette.primary,
    background_color: brand.palette.background,
    start_url: '/',
    display: 'standalone',
  });
  return {
    name: 'brand',
    transformIndexHtml: () => [
      { tag: 'title', children: brand.siteName, injectTo: 'head' },
      {
        tag: 'link',
        attrs: { rel: 'icon', type: 'image/svg+xml', href: brand.faviconUrl },
        injectTo: 'head',
      },
      { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' },
    ],
    configureServer(server) {
      server.middlewares.use('/manifest.webmanifest', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(manifest);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest });
    },
  };
}

export default defineConfig({
  plugins: [react(), brandPlugin()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  // React + MUI + GraphQL clients make one ~180 kB (gzip) vendor bundle; fine for this app.
  build: { chunkSizeWarningLimit: 800 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Tests run as dev user 1 against MSW mocks.
    env: { VITE_DEV_USER: '1:wallet' },
  },
});
