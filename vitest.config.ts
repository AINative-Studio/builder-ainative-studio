import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // #760: force @ainative/ai-kit through Vite's own transform/resolve
    // pipeline (where the alias below applies) instead of Node's native ESM
    // loader, which Vitest otherwise uses for real node_modules dependencies
    // in the 'node' environment and which fails on the package's own bad
    // bare-directory import of react-syntax-highlighter's prism styles.
    server: { deps: { inline: [/@ainative\/ai-kit/] } },
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
      // Scope coverage to the core builder business logic we own + test. Measuring
      // the whole repo would dilute the number with hundreds of untested legacy UI
      // files (making the % meaningless and CI useless). `lib/build` + `lib/growth`
      // is where the testable logic lives; it currently sits at ~98%/100%.
      include: ['lib/build/**', 'lib/growth/**', 'lib/help/**'],
      exclude: [
        'node_modules/',
        '__tests__/',
        '*.config.{js,ts}',
        '.next/',
        'coverage/',
        // Thin React hooks / re-export shims measured elsewhere; keep them in the
        // number but never let a barrel file game the threshold.
      ],
      // CI gate: fail the run if core builder logic regresses below 80%. We are
      // well above this today (statements ~98%, branches ~87%); the floor guards
      // against future regressions. Raise as coverage climbs.
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './') },
      // #760: @ainative/ai-kit@0.2.0's ESM build (dist/index.mjs) imports
      // 'react-syntax-highlighter/dist/cjs/styles/prism' as a bare directory
      // specifier, which Node's own ESM resolver (used by Vitest, unlike
      // Next/webpack's looser resolution) refuses to resolve without an
      // explicit '/index.js'. Any test that transitively imports Live.tsx
      // (which now imports @ainative/ai-kit for StreamingMessage) hits this.
      // A regex find matches the specifier regardless of which nested
      // node_modules copy of react-syntax-highlighter resolves it (pnpm
      // hoists @ainative/ai-kit's own copy under its own .pnpm entry).
      // Works around the upstream package's packaging bug without patching
      // node_modules; safe to remove once @ainative/ai-kit publishes a
      // fixed build with an explicit subpath.
      {
        find: /^react-syntax-highlighter\/dist\/cjs\/styles\/prism$/,
        replacement: path.resolve(__dirname, 'node_modules/react-syntax-highlighter/dist/cjs/styles/prism/index.js'),
      },
    ],
  },
})
