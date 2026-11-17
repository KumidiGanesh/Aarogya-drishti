import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  envDir: '..',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'AAROGYA DRISHTI ITDA PADERU',
        short_name: 'Aarogya Paderu',
        theme_color: '#123B66',
        background_color: '#F4F9FF',
        display: 'standalone',
        icons: [],
      },
    }),
  ],
  server: { host: '0.0.0.0', port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const modulePath = id.replaceAll('\\', '/');
          if (!modulePath.includes('/node_modules/')) return undefined;
          if (
            modulePath.includes('/recharts/')
            || modulePath.includes('/d3-')
          ) return 'charts';
          return 'vendor';
        },
      },
    },
  },
  test: { environment: 'jsdom', setupFiles: './src/test/setup.js', globals: true },
});
