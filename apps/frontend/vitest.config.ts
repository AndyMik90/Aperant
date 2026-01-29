import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    exclude: ['node_modules', 'dist', 'out'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts', 'src/**/*.spec.tsx', 'src/**/*.d.ts']
    },
    // Mock Electron modules for unit tests
    alias: {
      electron: resolve(__dirname, 'src/__mocks__/electron.ts'),
      '@sentry/electron/main': resolve(__dirname, 'src/__mocks__/sentry-electron-main.ts'),
      '@sentry/electron/renderer': resolve(__dirname, 'src/__mocks__/sentry-electron-renderer.ts')
    },
    // Setup files for test environment
    setupFiles: ['src/__tests__/setup.ts']
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@preload': resolve(__dirname, 'src/preload'),
      '@features': resolve(__dirname, 'src/renderer/features'),
      '@components': resolve(__dirname, 'src/renderer/shared/components'),
      '@hooks': resolve(__dirname, 'src/renderer/shared/hooks'),
      '@lib': resolve(__dirname, 'src/renderer/shared/lib')
    }
  }
});
