import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'
import path from 'path'

// Real-account specs (e.g. e2e/full-onboarding-provision.spec.ts,
// e2e/e2e-session-restore.spec.ts) gate themselves on E2E_TEST_EMAIL /
// E2E_TEST_PASSWORD rather than ever hardcoding a credential. Those values
// live in .env.e2e.local (gitignored, never committed) so a local run with
// that file present picks them up automatically instead of requiring every
// contributor to export them into their shell by hand. Loaded here —
// Playwright's own config entrypoint — rather than per-spec, so every
// current and future env-gated spec benefits without duplicating the
// dotenv call. Silently a no-op when the file doesn't exist (CI/most local
// checkouts), matching every other env-gated spec's existing skip-not-fail
// behavior.
dotenv.config({ path: path.resolve(__dirname, '.env.e2e.local') })

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Run tests sequentially to avoid rate limiting
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Single worker to avoid concurrent rate limits
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 120_000, // 2 min per test (AI generation can be slow)

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  outputDir: 'e2e/test-results',
})
