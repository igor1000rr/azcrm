import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // JSX automatic трансформ — React 17+ режим, не требует import React.
  // Без этого tests/components/*.tsx падают с "React is not defined".
  esbuild: {
    jsx:             'automatic',
    jsxImportSource: 'react',
  },
  test: {
    environment: 'node',
    // tests/components/** запускаются под jsdom (для @testing-library/react),
    // остальное — под node (быстрее, не нужен DOM).
    environmentMatchGlobs: [
      ['tests/components/**', 'jsdom'],
    ],
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.{ts,tsx}',
      'tests/components/**/*.test.{ts,tsx}',
    ],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/lib/**/*.ts',
        'src/app/**/actions.ts',
        'src/app/api/**/*.ts',
        'src/components/**/*.tsx',
      ],
      exclude: ['**/*.d.ts', '**/node_modules/**'],
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
