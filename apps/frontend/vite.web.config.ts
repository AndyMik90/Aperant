/**
 * Vite Configuration for Web Build
 *
 * This config builds the frontend as a standard web app without Electron dependencies.
 * The output can be served by any static file server or the web-server backend.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Sentry configuration (optional)
const sentryDefines = {
  '__SENTRY_DSN__': JSON.stringify(process.env.SENTRY_DSN || ''),
  '__SENTRY_TRACES_SAMPLE_RATE__': JSON.stringify(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
  '__SENTRY_PROFILES_SAMPLE_RATE__': JSON.stringify(process.env.SENTRY_PROFILES_SAMPLE_RATE || '0.1'),
};

export default defineConfig({
  plugins: [react()],

  root: resolve(__dirname, 'src/renderer'),

  base: '/',

  define: {
    ...sentryDefines,
    // Flag to indicate web mode
    '__WEB_MODE__': JSON.stringify(true),
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
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
      },
      output: {
        manualChunks: {
          // Split vendor chunks for better caching
          'react-vendor': ['react', 'react-dom'],
          'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-tabs'],
          'xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-webgl'],
        },
      },
    },
  },

  server: {
    port: 5173,
    proxy: {
      // Proxy API requests to the web server
      '/api': {
        target: 'http://localhost:3456',
        changeOrigin: true,
      },
      // Proxy WebSocket connections
      '/socket.io': {
        target: 'http://localhost:3456',
        ws: true,
      },
    },
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.worktrees/**',
        '**/.auto-claude/**',
        '**/out/**',
      ],
    },
  },

  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:3456',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3456',
        ws: true,
      },
    },
  },

  optimizeDeps: {
    include: ['react', 'react-dom', 'socket.io-client'],
    exclude: ['electron'],
  },
});
