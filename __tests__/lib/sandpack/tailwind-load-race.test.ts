import { describe, it, expect } from 'vitest'
import { templateFiles } from '@/lib/sandpack/setup'

/**
 * Real production bug found live (2026-10-19): 9 of 23 real companies'
 * /build/{slug} previews rendered with zero CSS applied — real content,
 * real Tailwind classNames in the DOM, just unstyled. Two-layer root cause:
 *
 *   1. Tailwind's CDN script was loaded via Sandpack's `externalResources`
 *      option — an async <script> injected AFTER the bundler's HTML shell
 *      had already loaded, racing React's render.
 *   2. Even loading it as a blocking <script> in the HTML shell wasn't
 *      enough on its own: the script sets `window.tailwind` synchronously
 *      on load, but the actual CSS compile+inject (via a MutationObserver
 *      that needs real DOM content to scan) happens asynchronously AFTER
 *      React mounts — confirmed live, the blocking-script-only fix did not
 *      resolve the bug on retest.
 *
 * Real fix: #root starts hidden (opacity:0), React mounts immediately (so
 * Tailwind's observer has content to scan), and a poll only reveals #root
 * once a real <style> tag with actual CSS content is confirmed present in
 * <head> — the one source of truth that styling has genuinely applied.
 */
describe('Sandpack preview — Tailwind CDN load-order race (#1115/#1117)', () => {
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

  it('#root starts hidden so the unstyled flash is never visible', () => {
    const html = templateFiles['/public/index.html']
    expect(html).toMatch(/id="root"\s+style="opacity:\s*0;?"/)
  })

  it('index.tsx mounts React immediately (Tailwind needs real DOM content to scan)', () => {
    const indexTsx = templateFiles['/src/index.tsx']
    // The createRoot/render call must not be gated behind any wait — mount
    // happens unconditionally and synchronously at module load.
    const mountIndex = indexTsx.indexOf('root.render(<App />)')
    const revealIndex = indexTsx.indexOf('revealOnceStyled(')
    expect(mountIndex).toBeGreaterThan(-1)
    expect(revealIndex).toBeGreaterThan(-1)
    expect(mountIndex).toBeLessThan(revealIndex)
  })

  it('reveals #root only once a real <style> tag with actual CSS content is confirmed present', () => {
    const indexTsx = templateFiles['/src/index.tsx']
    expect(indexTsx).toContain('document.head.querySelectorAll(\'style\')')
    expect(indexTsx).toContain('.textContent || \'\').length > 0')
    expect(indexTsx).toContain('el.style.opacity = \'1\'')
    // Bounded: must not be an unconditional infinite wait — a genuinely
    // blocked/offline script must still eventually reveal the (unstyled)
    // content rather than leaving it permanently invisible.
    expect(indexTsx).toMatch(/Date\.now\(\)\s*>=\s*deadline/)
  })
})
