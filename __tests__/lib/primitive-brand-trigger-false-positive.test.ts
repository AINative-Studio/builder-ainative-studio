import { describe, it, expect } from 'vitest'
import { selectPrimitives } from '@/lib/build/primitive-catalog'
import fs from 'fs'
import path from 'path'

/**
 * Real bug (customer-reported, Meridian, https://builder.ainative.studio/build/meridian,
 * 2026-09-10): app/api/build/company-app/route.ts's own hardcoded prompt
 * template — the ONE real generated app every Company-track company gets —
 * always said "Use {color} as the primary brand color." ZeroCommerce's
 * trigger list used to include the bare word 'brand', so selectPrimitives()
 * matched EVERY Company-track landing page as an ecommerce request. The
 * model then got steered toward building an unrelated storefront/cart/
 * checkout app instead of the requested marketing landing page, and that
 * off-topic generation truncated (missing ./ui/button, ./ui/badge, etc.),
 * reproduced 4/4 times in a row via real production requests.
 *
 * Fixed two ways: (1) 'brand' removed as a ZeroCommerce trigger — too
 * generic a word to signal ecommerce specifically (every company has "a
 * brand"), and (2) company-app's own template reworded to "main accent
 * color" so it no longer relies on a word that happened to collide with
 * primitive-selection vocabulary at all.
 */
describe('ZeroCommerce trigger no longer false-matches generic "brand" language (2026-09-10)', () => {
  it('a plain landing-page brief mentioning "brand color" does NOT select ZeroCommerce', () => {
    const idea = 'Use #2D6BE4 as the primary brand color for this landing page.'
    const sel = selectPrimitives(idea, 'company')
    expect(sel.names).not.toContain('ZeroCommerce')
  })

  it('a genuine ecommerce idea still correctly selects ZeroCommerce via its other real triggers', () => {
    const idea = 'an online store where customers can browse products and checkout with a cart'
    const sel = selectPrimitives(idea, 'company')
    expect(sel.names).toContain('ZeroCommerce')
  })

  it("'brand' is not in ZeroCommerce's trigger list at all", () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/build/primitive-catalog.ts'), 'utf8')
    const idx = source.indexOf("name: 'ZeroCommerce'")
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 2000)
    const triggersMatch = nearby.match(/triggers:\s*\[([^\]]*)\]/)
    expect(triggersMatch).toBeTruthy()
    expect(triggersMatch![1]).not.toMatch(/'brand'/)
  })

  it("company-app's actual prompt template literal no longer says 'brand color'", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/api/build/company-app/route.ts'),
      'utf8',
    )
    // Scope to the `const message = ...` template literal itself, not the
    // surrounding explanatory comments (which legitimately quote the OLD
    // wording to document what changed and why).
    const idx = source.indexOf('const message =')
    expect(idx).toBeGreaterThan(-1)
    const messageBlock = source.slice(idx, idx + 600)
    expect(messageBlock).not.toMatch(/brand color/i)
    expect(messageBlock).toMatch(/main accent color/i)
  })
})

/**
 * Real regression caught while fixing the above: an earlier attempt at
 * hardening the trigger matcher used a FULL word-boundary regex (\b...\b on
 * both ends), which broke legitimate suffix matches — 'scrape' stopped
 * matching "scrapes"/"scraping", which Browser Agent's trigger list relies
 * on (and 'aggregat' is already a deliberate partial-word stem in this
 * catalog, relying on the same suffix-matching behavior). The fix uses a
 * LEADING boundary only (\b<trigger>, no trailing \b) — blocks a trigger
 * appearing as a SUFFIX of a different word (e.g. 'orders' inside
 * "disorders") while still allowing a trigger's own natural continuations.
 */
describe('primitive trigger matching still allows legitimate suffix continuations (regression guard)', () => {
  it('"scrapes" (plural/conjugated) still matches the "scrape" trigger', () => {
    const sel = selectPrimitives('a tool that scrapes competitor prices', 'company')
    expect(sel.names).toContain('Browser Agent')
  })

  it('"disorders" does NOT falsely match the "orders" trigger (suffix-of-different-word case)', () => {
    const sel = selectPrimitives('an app that tracks sleep disorders', 'company')
    expect(sel.names).not.toContain('ZeroCommerce')
  })
})
