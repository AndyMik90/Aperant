import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Get custom domain from environment variable
const customDomain = process.env.VITE_CUSTOM_DOMAIN || 'notesvnn.click';
// Get backend API URL from environment variable
const apiUrl = process.env.VITE_API_URL || '';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  define: {
    VITE_PLATFORM: JSON.stringify('web'),
    'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@features': resolve(__dirname, 'src/renderer/features'),
      '@components': resolve(__dirname, 'src/renderer/shared/components'),
      '@hooks': resolve(__dirname, 'src/renderer/shared/hooks'),
      '@lib': resolve(__dirname, 'src/renderer/shared/lib'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
      external: [
        'electron',
        '@lydell/node-pty',
        '@electron-toolkit/preload',
        '@electron-toolkit/utils',
        'electron-updater',
        'electron-log',
        '@sentry/electron',
      ],
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: [`autoclaude.${customDomain}`, `.${customDomain}`],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: true, // Enable WebSocket proxying
        // SSE (Server-Sent Events) configuration
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('Sending Request to the Target:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
          });
        },
      },
    },
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.worktrees/**',
        '**/.auto-claude/**',
        '**/out/**',
        resolve(__dirname, '../.worktrees/**'),
        resolve(__dirname, '../.auto-claude/**'),
      ],
    },
  },
});
