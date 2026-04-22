import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Run tests sequentially to avoid rate limiting
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Single worker to avoid concurrent rate limits
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 120_000, // 2 min per test (AI generation can be slow)

  use: {
    baseURL: 'https://builder.ainative.studio',
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
