import { describe, it, expect } from 'vitest'
import { selectPrimitives } from '@/lib/build/primitive-catalog'

/**
 * #1182's real acceptance claim: picking "Launch an online store" must
 * reliably compose ZeroCommerce, not depend on the founder's own prose
 * happening to match a trigger word. This confirms the exact idea text
 * BuildStart.tsx's pickEcommerce() seeds (`SET_IDEA, idea: 'Launch an
 * online store'`) plus the forced role:'sales' actually selects
 * ZeroCommerce (and its Sales-role companions) end to end through the
 * real selectPrimitives() pipeline — not a mocked/assumed result.
 */
describe('selectPrimitives — "Launch an online store" entry point composes ZeroCommerce (#1182)', () => {
  it('selects ZeroCommerce for the exact seeded idea text, with the sales role', () => {
    const { names } = selectPrimitives('Launch an online store', 'company', 6, 'sales')
    expect(names).toContain('ZeroCommerce')
  })

  it('also pulls in the Sales-role companions (ZeroPipeline, ZeroInvoice) alongside ZeroCommerce', () => {
    const { names } = selectPrimitives('Launch an online store', 'company', 6, 'sales')
    expect(names).toContain('ZeroPipeline')
    expect(names).toContain('ZeroInvoice')
  })

  it('still selects ZeroCommerce even WITHOUT the role boost — the seeded idea text alone is a real trigger match', () => {
    const { names } = selectPrimitives('Launch an online store', 'company')
    expect(names).toContain('ZeroCommerce')
  })
})
