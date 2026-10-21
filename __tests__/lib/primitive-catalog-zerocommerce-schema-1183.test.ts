import { describe, it, expect } from 'vitest'
import { getRuntimeProxyInstruction } from '@/lib/build/primitive-catalog'

/**
 * #1183 — Builder's ZeroCommerce codegen prompt (RUNTIME_PROXIED_PRIMITIVES
 * .ZeroCommerce in lib/build/primitive-catalog.ts) is the ONLY thing
 * standing between an LLM and silently-wrong field names/response shapes,
 * since the runtime proxy (app/api/primitive/[primitive]/[...path]/route.ts)
 * forwards whatever a generated app sends with zero schema validation.
 *
 * Every assertion below was re-verified directly against
 * AINative-Studio/ZeroCommerce's current source on 2026-10-21 (cloned
 * fresh, not assumed from the issue text or a stale prior read):
 *   - app/models/product.py (base_price, stock_quantity nullable, OptionSet)
 *   - app/api/v1/endpoints/storefront.py (StorefrontCheckoutRequest/Response,
 *     _public_product_dict, get_storefront_stripe_config)
 *   - app/schemas/cart.py (CartItemCreate — unit_price optional)
 *   - app/api/v1/api.py (route prefix registration)
 *
 * This suite pins the PROMPT TEXT to those real, confirmed shapes — it is
 * not an integration test against a live ZeroCommerce instance (none is
 * reachable from this test environment), it is a regression guard so the
 * prompt can never silently drift back to a guessed/stale shape the way it
 * did before (the old block never mentioned payment_provider, order_id, or
 * approval_url on checkout at all, and had a stale "not yet implemented"
 * comment for stripe-config, which is real and live).
 */
describe('RUNTIME_PROXIED_PRIMITIVES.ZeroCommerce — real schema pins (#1183)', () => {
  const instruction = getRuntimeProxyInstruction('ZeroCommerce')!

  it('exists', () => {
    expect(instruction).toBeTruthy()
  })

  it('product field is base_price, confirmed against app/models/product.py — never a bare `price` field', () => {
    expect(instruction).toContain('base_price')
    // The anti-pattern language must explicitly forbid the wrong field name,
    // not just happen to use the right one in the example snippet.
    expect(instruction).toMatch(/FORBIDDEN:[^.]*`price`[^.]*`base_price`/)
  })

  it('warns that stock_quantity is never present on the public storefront products response, confirmed against _public_product_dict', () => {
    expect(instruction).toMatch(/stock_quantity/)
    expect(instruction).toMatch(/never (?:present|exposed)|no stock_quantity/i)
  })

  it('checkout request includes payment_provider, confirmed against StorefrontCheckoutRequest', () => {
    expect(instruction).toContain('payment_provider')
    expect(instruction).toMatch(/'stripe'[\s\S]*'paypal'[\s\S]*'crypto'|stripe[\s\S]*paypal[\s\S]*crypto/i)
  })

  it('checkout request includes discount_code as the real (only) coupon-apply field, confirmed against StorefrontCheckoutRequest', () => {
    expect(instruction).toContain('discount_code')
  })

  it('checkout response destructuring includes order_id, payment_intent_id, and approval_url — not just client_secret, confirmed against StorefrontCheckoutResponse', () => {
    expect(instruction).toMatch(/const\s*\{[^}]*order_id[^}]*\}\s*=\s*await checkoutRes\.json\(\)/)
    expect(instruction).toContain('payment_intent_id')
    expect(instruction).toContain('approval_url')
  })

  it('instructs redirecting to approval_url for PayPal BEFORE any Stripe Elements code runs', () => {
    const approvalIdx = instruction.indexOf('approval_url')
    const stripeElementsIdx = instruction.indexOf('loadStripe')
    expect(approvalIdx).toBeGreaterThan(-1)
    expect(stripeElementsIdx).toBeGreaterThan(-1)
    expect(approvalIdx).toBeLessThan(stripeElementsIdx)
  })

  it('shipping_address is sent as a plain JSON object, never client-side encrypted, confirmed server encrypts on write', () => {
    expect(instruction).toMatch(/shipping_address[\s\S]*encrypt|encrypt[\s\S]*server-side/i)
  })

  it('does NOT claim stripe-config is pending/not-yet-implemented — confirmed real and live in get_storefront_stripe_config', () => {
    expect(instruction).toContain('stripe-config')
    expect(instruction).not.toMatch(/stripe-config does not exist|stripe-config is (?:not yet implemented|pending)|does not exist on ZeroCommerce yet/i)
    // The prompt should actively assert it's real, not merely omit a caveat.
    expect(instruction).toMatch(/real and live|is real now|confirmed/i)
  })

  it('cart item add still instructs never sending a client-supplied price, confirmed unit_price is server-resolved in CartItemCreate', () => {
    expect(instruction).toMatch(/unit_price is resolved server-side|do NOT send a client price/i)
  })
})
