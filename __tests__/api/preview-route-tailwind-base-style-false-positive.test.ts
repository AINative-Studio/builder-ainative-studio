// @vitest-environment jsdom
import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real bug (#1881), found auditing the fallback /api/preview/[id] route's
 * Tailwind-reveal logic added 2026-10-19 (#1115/#1117) for the OTHER
 * Tailwind-load-order race already covered by
 * preview-route-tailwind-load-race.test.ts.
 *
 * `_tailwindStyleInjected()` was meant to only reveal #root once Tailwind's
 * CDN script has actually compiled and injected its own <style> tag with
 * real CSS content — but it checked for ANY <style> tag in <head> with
 * non-empty textContent. This route's own HTML shell already has a static
 * <style> block (body font, box-sizing reset, the loading-indicator spinner
 * CSS) hard-coded directly in <head>, present from first paint, long before
 * Tailwind's CDN script even starts loading. That block always has
 * non-empty textContent, so the check was satisfied immediately on its very
 * first call — the "wait for Tailwind" logic never actually waited,
 * reproducing the exact unstyled-content symptom the 2026-10-19 fix exists
 * to prevent, just via an always-true condition instead of no condition at
 * all.
 *
 * This extracts the REAL `_tailwindStyleInjected()` function body straight
 * out of the route's source (not a hand-copy that could drift) and executes
 * it against a jsdom <head> shaped exactly like the real shell, to prove
 * the check's actual behavior rather than just asserting source text (the
 * gap that let this slip past the existing source-text-only regression
 * test).
 */
describe('/api/preview/[id] route — Tailwind-reveal check is not fooled by the shell\'s own static <style> tag (#1881)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/api/preview/[id]/route.ts'),
    'utf8',
  )

  function extractTailwindStyleInjected(): () => boolean {
    const start = source.indexOf('function _tailwindStyleInjected()')
    expect(start).toBeGreaterThan(-1)
    const end = source.indexOf('\n          }', start) + '\n          }'.length
    const fnSource = source.slice(start, end)
    // eslint-disable-next-line no-new-func
    const factory = new Function(`${fnSource}\nreturn _tailwindStyleInjected;`)
    return factory()
  }

  it('the real shell markup gives its static style block the id this check must skip', () => {
    expect(source).toMatch(/<style id="ainative-base-styles">/)
  })

  it('returns false when only the shell\'s own static base-styles tag is present (Tailwind has not injected anything yet)', () => {
    document.head.innerHTML = `
      <style id="ainative-base-styles">body { margin: 0; } #loading-indicator { display: flex; }</style>
    `
    const tailwindStyleInjected = extractTailwindStyleInjected()
    expect(tailwindStyleInjected()).toBe(false)
  })

  it('returns true once a REAL, separately-injected style tag (Tailwind\'s own) has content', () => {
    document.head.innerHTML = `
      <style id="ainative-base-styles">body { margin: 0; }</style>
      <style>.bg-blue-500{background-color:#3b82f6}</style>
    `
    const tailwindStyleInjected = extractTailwindStyleInjected()
    expect(tailwindStyleInjected()).toBe(true)
  })

  it('still returns false for an empty, not-yet-populated extra style tag (Tailwind injects the element before filling it)', () => {
    document.head.innerHTML = `
      <style id="ainative-base-styles">body { margin: 0; }</style>
      <style></style>
    `
    const tailwindStyleInjected = extractTailwindStyleInjected()
    expect(tailwindStyleInjected()).toBe(false)
  })
})
