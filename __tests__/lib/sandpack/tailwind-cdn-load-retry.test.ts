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
 * plain static `<script src>` tag has no built-in retry.
 *
 * FIRST FIX ATTEMPT (WRONG, caused a real regression): replaced the static
 * tag entirely with `document.createElement('script')` + `appendChild`.
 * That shipped, then broke wrench/lumeo/shingle — all previously verified
 * correctly styled — because a dynamically-created `<script>` element
 * ALWAYS loads asynchronously (per the HTML spec, regardless of
 * async/defer), unlike a static parser-inserted `<script src>` with
 * neither attribute, which genuinely blocks HTML parsing (and therefore
 * React's mount) until it loads. Losing that blocking guarantee
 * reintroduced the exact load-order race #1115/#1117/#1119 already fixed.
 *
 * REAL FIX (#1127): keep the static blocking tag as the primary load path
 * (this is what makes every other company's preview render correctly), and
 * attach the retry logic to THAT tag's own `onerror` handler — so a retry
 * only ever happens after the primary synchronous attempt has already
 * failed, never replacing it.
 */
describe('Sandpack preview — Tailwind CDN script load retry on failure (#1126/#1127)', () => {
  it('the retry attaches to the static tag\'s own onerror — it never replaces the static tag', () => {
    const html = templateFiles['/public/index.html']
    const tailwindIndex = html.indexOf('<script src="https://cdn.tailwindcss.com"')
    expect(tailwindIndex).toBeGreaterThan(-1)
    const tailwindScriptTag = html.slice(tailwindIndex, html.indexOf('</script>', tailwindIndex) + '</script>'.length)

    // The onerror attribute calls the named retry function; the function's
    // own body (defined in a preceding <script> block) does the actual
    // dynamic-script-with-retry work.
    expect(tailwindScriptTag).toMatch(/onerror="_twRetry\(1\)"/)
    expect(html).toContain("s.src = 'https://cdn.tailwindcss.com'")
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

  it('the static tag (and its onerror retry) is declared before the body/root div', () => {
    const html = templateFiles['/public/index.html']
    const tailwindIndex = html.indexOf('<script src="https://cdn.tailwindcss.com"')
    const rootDivIndex = html.indexOf('id="root"')
    expect(tailwindIndex).toBeGreaterThan(-1)
    expect(tailwindIndex).toBeLessThan(rootDivIndex)
  })

  it('does not declare async or defer on the primary tag — those would reintroduce the original load-order race', () => {
    const html = templateFiles['/public/index.html']
    const tailwindIndex = html.indexOf('<script src="https://cdn.tailwindcss.com"')
    const tailwindScriptTag = html.slice(tailwindIndex, html.indexOf('</script>', tailwindIndex) + '</script>'.length)
    expect(tailwindScriptTag).not.toMatch(/\basync\b/)
    expect(tailwindScriptTag).not.toMatch(/\bdefer\b/)
  })
})
