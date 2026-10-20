import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real production bug found live (2026-10-19), second occurrence of the same
 * root cause already fixed in lib/sandpack/setup.ts for the Sandpack preview
 * path: the fallback /api/preview/[id] route (hit whenever Sandpack's own
 * 15s watchdog times out and falls back to this flattened-code iframe —
 * confirmed live for lumeo, wrench) revealed its rendered content as soon as
 * React's root.render() was called, with no check that Tailwind's CDN
 * script had actually finished compiling and injecting its <style> tag.
 * Tailwind's CDN script sets window.tailwind SYNCHRONOUSLY on load, but the
 * real CSS generation (DOM scan via MutationObserver, PostCSS compile) only
 * starts once real content exists to scan and resolves asynchronously after
 * that — so "React rendered" does not mean "styling applied".
 *
 * An even earlier premature reveal existed too: the Babel-COMPILE step (long
 * before React even mounts) used to hide the loading indicator the instant
 * compilation succeeded, leaving neither a loader nor styled content visible
 * for the whole gap until the later render step ran.
 */
describe('/api/preview/[id] route — Tailwind CDN load-order race (#1115/#1117)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/api/preview/[id]/route.ts'),
    'utf8',
  )

  it('#root starts hidden so the unstyled flash is never visible', () => {
    expect(source).toMatch(/id="root"\s+style="opacity:\s*0;?"/)
  })

  it('the Babel-compile step no longer hides the loading indicator prematurely', () => {
    // The old bug: `document.body.appendChild(_s);` was immediately followed
    // by hiding the loader, before the injected script had even executed.
    const appendIndex = source.indexOf('document.body.appendChild(_s);')
    expect(appendIndex).toBeGreaterThan(-1)
    const nextFewLines = source.slice(appendIndex, appendIndex + 500)
    expect(nextFewLines).not.toContain("getElementById('loading-indicator').style.display = 'none'")
  })

  it('reveals #root and hides the loader only once a real <style> tag with actual CSS content is confirmed present', () => {
    expect(source).toContain('_tailwindStyleInjected')
    expect(source).toContain('_revealOnceStyled')
    expect(source).toMatch(/styles\[i\]\.textContent && styles\[i\]\.textContent\.length > 0/)
    // Bounded: a genuinely blocked/offline script must still eventually
    // reveal the (unstyled) content rather than leaving it hidden forever.
    expect(source).toMatch(/Date\.now\(\)\s*>=\s*deadline/)
  })

  it('the reveal logic runs after root.render(), not before', () => {
    const renderIndex = source.indexOf('root.render(wrappedElement);')
    const revealIndex = source.indexOf('_revealOnceStyled(Date.now()')
    expect(renderIndex).toBeGreaterThan(-1)
    expect(revealIndex).toBeGreaterThan(-1)
    expect(renderIndex).toBeLessThan(revealIndex)
  })
})
