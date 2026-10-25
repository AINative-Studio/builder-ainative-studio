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
      // #1199: widened from lib/build+lib/growth+lib/help (the old scope, ~98%)
      // to the two directories where UNIT tests are the right tool — lib/** in
      // full and components/**. Measured directly before widening (2026-10-25):
      // lib/ alone was 88.9%, components/ alone was 62.93%, and the two TOGETHER
      // are 84.51% statements / 85.92% branches / 85.86% functions / 84.51%
      // lines — already above the 80% floor below, so this widening is a real
      // regression guard from day one, not an aspirational target nobody meets.
      //
      // app/** is deliberately excluded: its page.tsx/layout.tsx files are thin
      // routing/composition shells meant to be covered by Playwright E2E (see
      // app/api/** route handlers for the one exception that DOES get real unit
      // coverage already — a good candidate for a future widening once its own
      // aggregate is measured, per #1199's own staged-rollout framing).
      include: ['lib/**', 'components/**'],
      exclude: [
        'node_modules/',
        '__tests__/',
        '*.config.{js,ts}',
        '.next/',
        'coverage/',
        '**/*.d.ts',
      ],
      // CI gate: fail the run if lib/+components/ coverage regresses below 80%.
      // Measured well above this today (see note above); the floor guards
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
