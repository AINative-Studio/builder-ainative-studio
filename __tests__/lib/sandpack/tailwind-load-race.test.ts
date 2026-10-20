import { describe, it, expect } from 'vitest'
import { templateFiles } from '@/lib/sandpack/setup'

/**
 * Real production bug found live (2026-10-19): 9 of 23 real companies'
 * /build/{slug} previews rendered with zero CSS applied — real content,
 * real Tailwind classNames in the DOM, just unstyled. Long investigation,
 * several layers, culminating in the actual root cause (#1129):
 *
 *   1. Tailwind's CDN script was loaded via Sandpack's `externalResources`
 *      option — an async <script> injected AFTER the bundler's HTML shell
 *      had already loaded, racing React's render.
 *   2. Loading it as a blocking <script> in the HTML shell wasn't enough on
 *      its own in every case — layers below explain why.
 *   3. The mount-gating fix was initially written to the wrong file path
 *      ('/src/index.tsx' instead of the template's real '/index.tsx').
 *   4. THE ACTUAL ROOT CAUSE (#1129), found by cloning and reading the real
 *      AINative-Studio/sandpack-bundler source: its replaceHTML()
 *      (src/utils/html.ts) parses this file into { head, body }, but ONLY
 *      ever applies `document.body.innerHTML = body` — the source has a
 *      literal comment "// We only replace the body for now". The parsed
 *      `head` is returned but never used by the caller. This means <head>
 *      content in this file — EVERY <script>/<link>/<meta> tag placed
 *      there across every fix attempted before #1129 — was NEVER actually
 *      applied to the real document by this bundler. Confirmed directly:
 *      diagnostic logging showed the real document.head containing ONLY
 *      the bundler's own runtime script, never our Tailwind tag, on
 *      repeated reloads of wrench (a company working correctly before any
 *      of tonight's changes — meaning this bug likely always existed;
 *      earlier successes loaded Tailwind via some other path entirely).
 *
 * Real fix: since only `body` is ever applied, the Tailwind script (and
 * anything else that must actually run) lives in <body>, before #root, not
 * in <head>.
 */
describe('Sandpack preview — Tailwind CDN load-order race (#1115/#1117/#1119/#1129)', () => {
  it('declares the Tailwind CDN script in <body> (not <head>, which this bundler never applies), before #root', () => {
    const html = templateFiles['/public/index.html']

    const tailwindIndex = html.indexOf('<script src="https://cdn.tailwindcss.com">')
    expect(tailwindIndex).toBeGreaterThan(-1)

    const tailwindScriptTag = html.slice(tailwindIndex, html.indexOf('</script>', tailwindIndex) + '</script>'.length)
    expect(tailwindScriptTag).not.toMatch(/\basync\b/)
    expect(tailwindScriptTag).not.toMatch(/\bdefer\b/)
    // Exactly the plain tag — no onerror/retry wiring, no dynamic creation.
    expect(tailwindScriptTag).toBe('<script src="https://cdn.tailwindcss.com"></script>')

    // Must be inside <body>, after the opening <body> tag — this bundler's
    // replaceHTML() only ever applies document.body.innerHTML, so anything
    // placed in <head> is silently discarded.
    const bodyOpenIndex = html.indexOf('<body')
    expect(bodyOpenIndex).toBeGreaterThan(-1)
    expect(tailwindIndex).toBeGreaterThan(bodyOpenIndex)

    // Must still appear before the #root div, so it has a chance to load
    // before React mounts into it.
    const rootDivIndex = html.indexOf('id="root"')
    expect(tailwindIndex).toBeLessThan(rootDivIndex)
  })

  it('declares nothing load-bearing inside <head> — this bundler never applies <head> content', () => {
    const html = templateFiles['/public/index.html']
    const headMatch = html.match(/<head>([\s\S]*)<\/head>/)
    expect(headMatch).toBeTruthy()
    const headContent = headMatch![1]
    // <head> may still carry non-executing metadata (meta/link/title) that
    // degrades gracefully if ignored, but must never be the only place a
    // <script> this app depends on lives.
    expect(headContent).not.toMatch(/<script/)
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
