import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Only this project's own tests. Without an explicit include/exclude,
    // vitest globs the whole tree — including leftover subagent git worktrees
    // under .claude/worktrees/ that contain entirely different projects, which
    // pollute the run with hundreds of unrelated (failing) tests and hang the
    // runner on their open handles.
    include: ['__tests__/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      'node_modules/**',
      '.next/**',
      '.claude/**',
      'coverage/**',
      'e2e/**', // Playwright specs run via `npm run test:e2e`, not vitest
      'frontend/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '__tests__/',
        '*.config.{js,ts}',
        '.next/',
        'coverage/',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
