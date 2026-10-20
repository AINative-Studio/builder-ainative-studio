import { describe, it, expect } from 'vitest'
import { templateFiles } from '@/lib/sandpack/setup'

/**
 * Real production bug found live (2026-10-19/20, tidemark): even with a
 * clean Sandpack compile (confirmed via Sandpack's own relayed console:
 * "done"/"success" lifecycle events, zero errors) and the full reveal
 * deadline elapsed, direct in-iframe diagnostic logging showed
 * `window.tailwind === undefined` and zero `<style>` tags in `<head>` — the
 * Tailwind CDN script never executed at all. Non-deterministic across
 * reloads of the exact same app (sometimes loaded fine, sometimes didn't),
 * with the self-hosted bundler's own CPU/memory confirmed idle at the time
 * (ruling out server-side overload). This points to a transient network
 * fetch failure for the external `cdn.tailwindcss.com` script itself — a
 * plain static `<script src>` tag has no way to detect or recover from
 * that; a blocked/failed script tag fails silently with nothing landing in
 * `window.onerror` in a way distinguishable from anything else.
 *
 * Fix: load the script via a real `document.createElement('script')` +
 * `onerror` retry loop instead of a static tag, so a failed fetch is
 * actually observable and retried.
 */
describe('Sandpack preview — Tailwind CDN script load retry on failure (#1126)', () => {
  it('loads Tailwind via a script element with an onerror retry, not a static unrecoverable tag', () => {
    const html = templateFiles['/public/index.html']
    expect(html).toContain("s.src = 'https://cdn.tailwindcss.com'")
    expect(html).toContain('s.onerror')
    expect(html).toContain('document.head.appendChild(s)')
  })

  it('retries a bounded number of times, not forever and not just once', () => {
    const html = templateFiles['/public/index.html']
    const retryMatch = html.match(/attempt\s*<\s*(\d+)/)
    expect(retryMatch).toBeTruthy()
    const maxAttempts = Number(retryMatch![1])
    expect(maxAttempts).toBeGreaterThan(1)
    expect(maxAttempts).toBeLessThanOrEqual(5)
  })

  it('the retry loader runs before the body/root div, so a slow-but-eventually-successful retry still has time to be caught by revealOnceStyled', () => {
    const html = templateFiles['/public/index.html']
    const loaderIndex = html.indexOf('loadTailwind')
    const rootDivIndex = html.indexOf('id="root"')
    expect(loaderIndex).toBeGreaterThan(-1)
    expect(loaderIndex).toBeLessThan(rootDivIndex)
  })
})
