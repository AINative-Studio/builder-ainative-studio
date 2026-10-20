import { describe, it, expect } from 'vitest'
import { templateFiles } from '@/lib/sandpack/setup'

/**
 * Real production bug found live (2026-10-19): 9 of 23 real companies'
 * /build/{slug} previews rendered with zero CSS applied — real content,
 * real Tailwind classNames in the DOM, just unstyled. Long investigation,
 * several layers, culminating in the actual root cause (#1129/#1130):
 *
 *   1. Tailwind's CDN script was loaded via Sandpack's `externalResources`
 *      option — an async <script> injected AFTER the bundler's HTML shell
 *      had already loaded, racing React's render.
 *   2. The mount-gating fix was initially written to the wrong file path
 *      ('/src/index.tsx' instead of the template's real '/index.tsx').
 *   3. First real-root-cause layer (#1129), found by cloning and reading
 *      the real AINative-Studio/sandpack-bundler source: its replaceHTML()
 *      (src/utils/html.ts) parses /public/index.html into { head, body },
 *      but ONLY ever applies `document.body.innerHTML = body` — the
 *      source has a literal comment "// We only replace the body for
 *      now". <head> content (every <script>/<link>/<meta> tag placed
 *      there) was therefore never applied to the real document at all.
 *   4. SECOND, deeper root-cause layer (#1130), found live immediately
 *      after moving the script to <body> and re-verifying — it STILL
 *      didn't execute. Root cause: `element.innerHTML = htmlString` is a
 *      standard, spec-defined DOM behavior where any <script> tag parsed
 *      out of that string is permanently inert and never executes, in any
 *      browser, regardless of where in the string it appears. This
 *      bundler's replaceHTML() has no code that extracts and re-creates
 *      those script nodes to make them live (the standard workaround for
 *      this exact browser quirk) — so NO <script> tag in this HTML file,
 *      head or body, has ever actually run via this mechanism.
 *
 * Real fix: stop relying on this file's own <script> tags at all. Load
 * Tailwind from inside /index.tsx instead — a real ES module the
 * bundler's own module system compiles and executes directly, an entirely
 * different (and proven-working) code path from this dead HTML-string
 * replacement. `document.createElement('script')` + `appendChild` from
 * WITHIN that module is standard, live DOM scripting, not subject to the
 * innerHTML-inert-script limitation — the element is attached directly via
 * the DOM API, never parsed from an HTML string.
 */
describe('Sandpack preview — Tailwind CDN load-order race (#1115/#1117/#1119/#1129/#1130)', () => {
  it('/public/index.html contains no <script> tags at all — this bundler never executes any of them, head or body', () => {
    const html = templateFiles['/public/index.html']
    // Both root causes (#1129: <head> never applied; #1130: innerHTML
    // scripts are inert everywhere) mean a <script> tag anywhere in this
    // file is dead weight at best, misleading at worst. None should exist.
    expect(html).not.toMatch(/<script/)
  })

  it('/public/index.html still declares non-executing metadata (meta/link/title) and the #root mount point', () => {
    const html = templateFiles['/public/index.html']
    expect(html).toContain('<div id="root"')
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

  it('/index.tsx loads Tailwind itself via a real DOM script element, not relying on the HTML shell', () => {
    const indexTsx = templateFiles['/index.tsx']
    expect(indexTsx).toContain("document.createElement('script')")
    expect(indexTsx).toContain("src = 'https://cdn.tailwindcss.com'")
    expect(indexTsx).toContain('document.head.appendChild(')
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

  it('still installs the "read only property" error-suppression listeners, now in /index.tsx since the HTML shell\'s own <script> version never ran', () => {
    const indexTsx = templateFiles['/index.tsx']
    expect(indexTsx).toContain("addEventListener('unhandledrejection'")
    expect(indexTsx).toContain("addEventListener('error'")
    expect(indexTsx).toContain('read only property')
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
