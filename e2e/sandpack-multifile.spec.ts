/**
 * E2E (#291): verify Sandpack actually bundles + renders a real MULTI-FILE app
 * (cross-file imports resolved) — the capability the Babel-in-iframe path lacks.
 *
 * Renders the harness at /test-components/sandpack-preview, which mounts
 * SandpackPreview with an App.tsx that imports a local Header + Card. Sandpack
 * runs a real bundler in a worker and renders inside its own sandboxed iframe, so
 * we reach into that frame to confirm both imported components rendered.
 */
import { test, expect } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test('Sandpack renders a multi-file app with resolved cross-file imports', async ({ page }) => {
  await page.goto(`${BASE}/test-components/sandpack-preview`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByTestId('sandpack-harness-ready')).toBeVisible({ timeout: 20_000 })

  // Sandpack renders the app inside its own iframe. Give the bundler time to boot
  // and compile (worker + esbuild), then reach into the preview frame.
  const previewFrame = page.frameLocator('iframe[title="Sandpack Preview"], iframe.sp-preview-iframe, iframe[class*="preview"]')

  // Both imported components must render — proving cross-file imports resolved.
  await expect(previewFrame.getByTestId('mf-header')).toBeVisible({ timeout: 45_000 })
  await expect(previewFrame.getByTestId('mf-header')).toHaveText('Sandpack Multi-File')
  await expect(previewFrame.getByTestId('mf-card')).toBeVisible({ timeout: 15_000 })
  await expect(previewFrame.getByTestId('mf-card')).toHaveText('Rendered via real bundler')
})
