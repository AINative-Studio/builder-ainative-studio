import { describe, it, expect } from 'vitest'
import { templateFiles } from '@/lib/sandpack/setup'

/**
 * Real production bug found live (2026-10-19): 9 of 23 real companies'
 * /build/{slug} previews rendered with zero CSS applied — real content,
 * real Tailwind classNames in the DOM, just unstyled. Root cause: Tailwind's
 * CDN script was loaded via Sandpack's `externalResources` option, which
 * injects it as an async <script> tag AFTER the bundler's HTML shell has
 * already loaded — racing against React's render on the self-hosted bundler
 * (slower/less cached than stock CodeSandbox). Fix: load it directly in the
 * static HTML shell as a blocking <script> (no async/defer), which the
 * browser must fetch and execute before parsing continues — and belt-and-
 * suspenders, have /src/index.tsx poll for window.tailwind before mounting
 * React, with a bounded timeout so a genuinely blocked script still renders.
 */
describe('Sandpack preview — Tailwind CDN load-order race (#1115)', () => {
  it('declares the Tailwind CDN script as a blocking tag in the HTML shell, before any other script', () => {
    const html = templateFiles['/public/index.html']
    const tailwindIndex = html.indexOf('<script src="https://cdn.tailwindcss.com">')
    expect(tailwindIndex).toBeGreaterThan(-1)

    // Must not carry async or defer — those would reintroduce the race this
    // fix exists to close.
    const tailwindScriptTag = html.slice(tailwindIndex, html.indexOf('</script>', tailwindIndex) + '</script>'.length)
    expect(tailwindScriptTag).not.toMatch(/\basync\b/)
    expect(tailwindScriptTag).not.toMatch(/\bdefer\b/)

    // Must appear before the body/root div — i.e. genuinely in <head>, not
    // injected after the app's mount point.
    const rootDivIndex = html.indexOf('id="root"')
    expect(tailwindIndex).toBeLessThan(rootDivIndex)
  })

  it('index.tsx waits for window.tailwind before mounting React, with a bounded fallback', () => {
    const indexTsx = templateFiles['/src/index.tsx']
    expect(indexTsx).toContain('window as any).tailwind')
    expect(indexTsx).toContain('mount()')
    // Bounded: must not be an unconditional infinite wait — a genuinely
    // blocked/offline script must still eventually render (unstyled is
    // strictly better than never rendering at all).
    expect(indexTsx).toMatch(/Date\.now\(\)\s*>=\s*deadline/)
  })
})
