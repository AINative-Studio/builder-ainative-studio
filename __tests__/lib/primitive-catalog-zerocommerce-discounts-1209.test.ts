import { describe, it, expect } from 'vitest'
import { getRuntimeProxyInstruction } from '@/lib/build/primitive-catalog'

/**
 * #1209 — Builder's ZeroCommerce codegen prompt had no instruction at all
 * for a generated app's merchant-side discount-code admin UI (create/list/
 * edit/delete), even though the shopper-side checkout flow could already
 * *apply* a code (#1183). This suite pins the new MERCHANT-SIDE discount
 * codes section added to RUNTIME_PROXIED_PRIMITIVES.ZeroCommerce.
 *
 * The real admin-gated endpoint (`commerce/discounts`, confirmed live via a
 * fresh clone of ZeroCommerce's own source — app/api/v1/endpoints/
 * discounts.py, gated by deps.get_admin_user) is NOT confirmed to be
 * reachable by an ordinary founder's AINative role claim (get_admin_user
 * checks role.lower() == 'admin', a platform-staff designation per
 * products.py's own comment, not "owns this store"). This suite verifies
 * the prompt is honest about that uncertainty rather than claiming the path
 * definitely works, consistent with the "documented but unconfirmed"
 * precedent already used for ServiceOS's PATCH /tickets/:id.
 */
describe('RUNTIME_PROXIED_PRIMITIVES.ZeroCommerce — merchant discount codes (#1209)', () => {
  const instruction = getRuntimeProxyInstruction('ZeroCommerce')!

  it('exists', () => {
    expect(instruction).toBeTruthy()
  })

  it('instructs calling the real admin commerce/discounts path through the same proxy', () => {
    expect(instruction).toContain('/api/primitive/zerocommerce/commerce/discounts')
  })

  it('distinguishes the merchant-only path from the unauthenticated storefront/_ paths', () => {
    expect(instruction).toMatch(/merchant-only|admin-only/i)
  })

  it('shows both a list (GET) and create (POST) call shape for discounts', () => {
    expect(instruction).toMatch(/fetch\('\/api\/primitive\/zerocommerce\/commerce\/discounts'\)/)
    expect(instruction).toMatch(/method:\s*'POST'[\s\S]*commerce\/discounts|commerce\/discounts'[\s\S]*method:\s*'POST'/)
  })

  it('discloses the unconfirmed admin-role gate as a known limitation, not a guaranteed-working path', () => {
    expect(instruction).toMatch(/KNOWN LIMITATION/)
    expect(instruction).toMatch(/role/i)
    expect(instruction).toMatch(/403/)
    expect(instruction).toMatch(/unconfirmed/i)
  })

  it('forbids faking discount-code success in local state or silently swallowing a 403', () => {
    expect(instruction).toMatch(/FORBIDDEN:[^.]*faking[^.]*discount/i)
    expect(instruction).toMatch(/silently swallowing a 403/i)
  })

  it('does not disturb the existing shopper-side checkout discount_code field or anti-patterns', () => {
    expect(instruction).toContain('discount_code')
    expect(instruction).toMatch(/do NOT hand-roll a product catalog, shopping cart, or checkout/)
  })
})
