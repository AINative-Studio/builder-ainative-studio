import { describe, it, expect } from 'vitest'
import { selectPrimitives, scorePrimitives } from '@/lib/build/primitive-catalog'

/**
 * #1102/#1113 — found live: habanero-hub's real idea ("A subscription box
 * for local, small-batch hot sauce makers — curate, ship monthly, let
 * subscribers rate and reorder favorites.") never scored ZeroCommerce at
 * all against the OLD trigger list (confirmed by reading matchesTrigger's
 * word-boundary matching against every existing trigger: none matched —
 * "reorder" doesn't contain a word-boundary "orders", "subscribers" isn't
 * a trigger). That's why the obedience gate's findPrimitiveComplianceGaps()
 * never flagged the generation for hand-rolling an `/api/db/habanero_orders`
 * table instead of using ZeroCommerce — the gate only checks primitives the
 * idea already scored, and this idea never scored ZeroCommerce in the first
 * place. Adding 'subscription box' (not bare 'subscription' — a SaaS
 * subscription business is NOT ecommerce, same false-positive class the
 * 'brand' trigger removal already learned from) closes that gap.
 */
describe('ZeroCommerce "subscription box" trigger (#1102/#1113)', () => {
  it('scores ZeroCommerce for the real habanero-hub idea text', () => {
    const idea = 'A subscription box for local, small-batch hot sauce makers — curate, ship monthly, let subscribers rate and reorder favorites.'
    const sel = selectPrimitives(idea, 'company')
    expect(sel.names).toContain('ZeroCommerce')
  })

  it('matches "subscription box" case-insensitively and with other words around it', () => {
    const scored = scorePrimitives('A monthly subscription box of curated snacks', 'company')
    const zc = scored.find((s) => s.primitive.name === 'ZeroCommerce')
    expect(zc?.matched).toContain('subscription box')
  })

  it('does NOT match bare "subscription" alone — a SaaS subscription tool is not ecommerce', () => {
    const scored = scorePrimitives('a subscription-based project management tool for remote teams', 'company')
    const zc = scored.find((s) => s.primitive.name === 'ZeroCommerce')
    expect(zc?.matched ?? []).not.toContain('subscription box')
    expect(zc?.matched ?? []).toEqual([])
  })
})
