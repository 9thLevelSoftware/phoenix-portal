import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Edge functions import Zod via the Deno npm specifier. Remap to the
      // installed node_modules package so Vitest can resolve the same source
      // file when running edge-function helpers under Node.
      'npm:zod@4.3.6': 'zod',
      'npm:zod@^4.3.6': 'zod',
      'npm:zod': 'zod',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx}',
    ],
    // Sync tests configuration
    testTimeout: 30000, // 30s timeout for Edge Function calls
    hookTimeout: 15000,
    // Enable mock mode by default for all tests (no live Supabase required)
    env: {
      MOCK_EDGE_FUNCTIONS: 'true',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/test/**',
        'src/lib/database.types.ts',
      ],
    },
  },
});
