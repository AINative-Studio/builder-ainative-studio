import { describe, it, expect } from 'vitest'
import { templateFiles } from '@/lib/sandpack/setup'

/**
 * Real production bug found live (2026-10-19): 9 of 23 real companies'
 * /build/{slug} previews rendered with zero CSS applied — real content,
 * real Tailwind classNames in the DOM, just unstyled. Three-layer
 * investigation (two fixes landed, neither sufficient alone, a third found
 * the fix was targeting the wrong file entirely):
 *
 *   1. Tailwind's CDN script was loaded via Sandpack's `externalResources`
 *      option — an async <script> injected AFTER the bundler's HTML shell
 *      had already loaded, racing React's render.
 *   2. Loading it as a blocking <script> in the HTML shell wasn't enough on
 *      its own: the script sets `window.tailwind` synchronously on load,
 *      but the actual CSS compile+inject (via a MutationObserver that needs
 *      real DOM content to scan) happens asynchronously AFTER React mounts.
 *   3. The mount-gating fix (#root hidden, revealed only once a real
 *      <style> tag is confirmed) was written to '/src/index.tsx' — but
 *      Sandpack's own `react-ts` template boots from ROOT '/index.tsx'
 *      (confirmed by reading @codesandbox/sandpack-react's
 *      REACT_TYPESCRIPT_TEMPLATE source: package.json main is
 *      "/index.tsx"). A files-map key only overrides the template file at
 *      the EXACT same path, so '/src/index.tsx' was dead code from the
 *      start — the template's own stock entry point (no Tailwind-wait logic
 *      at all) kept booting every real Sandpack preview. Confirmed live:
 *      wrench stayed blank 30+ seconds — past even Sandpack's own 15s
 *      watchdog — after layers 1+2 were believed fixed and deployed.
 *
 * Real fix: the override MUST be at '/index.tsx' (root), matching the
 * template's real entry point exactly.
 */
describe('Sandpack preview — Tailwind CDN load-order race (#1115/#1117/#1119)', () => {
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

  it('the mount-gating override lives at the template\'s REAL entry point, /index.tsx (root) — not /src/index.tsx', () => {
    // The real bug: this override was written to the wrong path and was
    // dead code. Assert directly on the key the template actually boots
    // from, and that the wrong path is NOT where the logic lives.
    expect(templateFiles['/index.tsx']).toBeDefined()
    expect(templateFiles['/index.tsx']).toContain('revealOnceStyled')
    expect(templateFiles['/src/index.tsx']).toBeUndefined()
  })

  it('/index.tsx mounts React immediately (Tailwind needs real DOM content to scan)', () => {
    const indexTsx = templateFiles['/index.tsx']
    // The createRoot/render call must not be gated behind any wait — mount
    // happens unconditionally and synchronously at module load.
    const mountIndex = indexTsx.indexOf('root.render(<App />)')
    const revealIndex = indexTsx.indexOf('revealOnceStyled(')
    expect(mountIndex).toBeGreaterThan(-1)
    expect(revealIndex).toBeGreaterThan(-1)
    expect(mountIndex).toBeLessThan(revealIndex)
  })

  it('reveals #root only once a real <style> tag with actual CSS content is confirmed present', () => {
    const indexTsx = templateFiles['/index.tsx']
    expect(indexTsx).toContain('document.head.querySelectorAll(\'style\')')
    expect(indexTsx).toContain('.textContent || \'\').length > 0')
    expect(indexTsx).toContain('el.style.opacity = \'1\'')
    // Bounded: must not be an unconditional infinite wait — a genuinely
    // blocked/offline script must still eventually reveal the (unstyled)
    // content rather than leaving it permanently invisible.
    expect(indexTsx).toMatch(/Date\.now\(\)\s*>=\s*deadline/)
  })

  /**
   * Real bug found live (2026-10-20): a fixed bound (tried 3s, 8s, 15s in
   * turn) could never cover every app size — vaultn's generation produced a
   * single 30,000-char App.tsx with no separate component files, and
   * Tailwind's JIT genuinely takes longer to compile that much JSX in one
   * pass. A fixed bound forces choosing between making small apps wait
   * unnecessarily long or leaving large ones revealed-but-unstyled. The
   * bound must scale to how much source Sandpack actually has to compile.
   */
  it('scales the reveal bound to the real app content size instead of using one fixed number for every app', () => {
    const indexTsx = templateFiles['/index.tsx']
    expect(indexTsx).toContain('__APP_SOURCE_CHARS__')
    expect(indexTsx).toMatch(/Math\.min\(\s*30000/)
    // A bounded cap must still exist even when scaling up — a genuinely
    // stuck compile must not wait forever regardless of reported size.
    expect(indexTsx).toMatch(/revealOnceStyled\(Date\.now\(\)\s*\+\s*_boundMs\)/)
  })
})
