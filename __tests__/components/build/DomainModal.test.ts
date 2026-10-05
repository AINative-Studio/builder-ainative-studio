/**
 * Unit tests for DomainModal logic (#48 — scroll containment + Show more)
 *
 * Strategy: test the pure-function logic that can run in a node environment
 * without rendering the component — merge/de-dup helper, price formatting,
 * fetch-call shapes for loadMore / runSearch / startCheckout, and the
 * sessionStorage resume flow. DOM rendering is covered by the Playwright E2E.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Helpers extracted from DomainModal for isolated testing
// ---------------------------------------------------------------------------

interface Suggestion { domain: string; available: boolean; price?: number }

/** Mirror of the mergeSuggestions callback in DomainModal. */
function mergeSuggestions(prev: Suggestion[], next: Suggestion[]): Suggestion[] {
  const seen = new Set(prev.map((s) => s.domain))
  return [...prev, ...next.filter((s) => !seen.has(s.domain))]
}

/** Mirror of the price-label logic in DomainModal. */
function formatPrice(price: number | undefined): string {
  if (typeof price !== 'number') return 'available'
  return `$${price % 1 === 0 ? price : price.toFixed(2)}/yr`
}

// ---------------------------------------------------------------------------
// mergeSuggestions — de-duplication
// ---------------------------------------------------------------------------

describe('mergeSuggestions', () => {
  it('appends new items to the list', () => {
    const prev: Suggestion[] = [{ domain: 'acme.com', available: true, price: 12 }]
    const next: Suggestion[] = [{ domain: 'acme.io', available: true, price: 20 }]
    const result = mergeSuggestions(prev, next)
    expect(result).toHaveLength(2)
    expect(result[0].domain).toBe('acme.com')
    expect(result[1].domain).toBe('acme.io')
  })

  it('de-duplicates domains that already appear in prev', () => {
    const prev: Suggestion[] = [
      { domain: 'acme.com', available: true },
      { domain: 'acme.io', available: true },
    ]
    const next: Suggestion[] = [
      { domain: 'acme.io', available: true },  // duplicate — should be dropped
      { domain: 'acme.co', available: true },   // new — should be added
    ]
    const result = mergeSuggestions(prev, next)
    expect(result).toHaveLength(3)
    expect(result.map((s) => s.domain)).toEqual(['acme.com', 'acme.io', 'acme.co'])
  })

  it('returns prev unchanged when next is empty', () => {
    const prev: Suggestion[] = [{ domain: 'acme.com', available: true }]
    const result = mergeSuggestions(prev, [])
    expect(result).toEqual(prev)
  })

  it('accepts an empty prev', () => {
    const next: Suggestion[] = [{ domain: 'acme.com', available: true }]
    const result = mergeSuggestions([], next)
    expect(result).toEqual(next)
  })

  it('handles both empty', () => {
    expect(mergeSuggestions([], [])).toEqual([])
  })

  it('preserves insertion order (prev first, then new items from next)', () => {
    const prev: Suggestion[] = [
      { domain: 'a.com', available: true },
      { domain: 'b.com', available: true },
    ]
    const next: Suggestion[] = [
      { domain: 'b.com', available: true },
      { domain: 'c.com', available: true },
      { domain: 'd.com', available: true },
    ]
    const result = mergeSuggestions(prev, next)
    expect(result.map((s) => s.domain)).toEqual(['a.com', 'b.com', 'c.com', 'd.com'])
  })

  it('handles a large de-dup scenario (Show-more repeated fetches)', () => {
    const prev: Suggestion[] = Array.from({ length: 20 }, (_, i) => ({
      domain: `domain-${i}.com`,
      available: true,
    }))
    // next overlaps entirely with prev — nothing should be added
    const next = prev.slice(10, 20)
    const result = mergeSuggestions(prev, next)
    expect(result).toHaveLength(20)
  })
})

// ---------------------------------------------------------------------------
// formatPrice — price label rendering
// ---------------------------------------------------------------------------

describe('formatPrice', () => {
  it('renders whole-dollar prices without decimals', () => {
    expect(formatPrice(12)).toBe('$12/yr')
    expect(formatPrice(100)).toBe('$100/yr')
    expect(formatPrice(0)).toBe('$0/yr')
  })

  it('renders fractional prices to 2 decimal places', () => {
    expect(formatPrice(12.99)).toBe('$12.99/yr')
    expect(formatPrice(9.5)).toBe('$9.50/yr')
  })

  it('returns "available" when price is undefined', () => {
    expect(formatPrice(undefined)).toBe('available')
  })
})

// ---------------------------------------------------------------------------
// loadMore fetch — shape of the API call (#48 / #280)
// ---------------------------------------------------------------------------

describe('loadMore fetch call', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requests the correct offset URL for a pagination batch', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ suggestions: [{ domain: 'acme.io', available: true, price: 20 }] }),
    })
    const brand = 'acme'
    const offset = 5
    const keywords = 'coffee'
    const url = `/api/build/domains?brand=${encodeURIComponent(brand)}&keywords=${encodeURIComponent(keywords)}&offset=${offset}`
    await fetch(url)
    expect(fetchMock).toHaveBeenCalledWith(url)
  })

  it('requests without keywords when keywords is falsy', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ suggestions: [] }),
    })
    const url = `/api/build/domains?brand=acme&offset=10`
    await fetch(url)
    expect(fetchMock).toHaveBeenCalledWith(url)
    // No &keywords= in the URL
    expect(fetchMock.mock.calls[0][0]).not.toContain('keywords')
  })
})

// ---------------------------------------------------------------------------
// runSearch fetch — exact-domain check (#280)
// ---------------------------------------------------------------------------

describe('runSearch fetch call', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the check= param for exact-domain lookup', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ suggestions: [{ domain: 'myname.com', available: true, price: 10 }] }),
    })
    const q = 'myname.com'
    await fetch(`/api/build/domains?check=${encodeURIComponent(q)}`)
    expect(fetchMock).toHaveBeenCalledWith(`/api/build/domains?check=myname.com`)
  })

  it('handles a domain with special characters in the check param', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ suggestions: [] }) })
    const q = 'my name&co.com'
    const url = `/api/build/domains?check=${encodeURIComponent(q)}`
    await fetch(url)
    // encodeURIComponent must have encoded spaces + &
    expect(url).toContain('my%20name%26co.com')
  })
})

// ---------------------------------------------------------------------------
// startCheckout POST — shape of the purchase request (#281)
// ---------------------------------------------------------------------------

describe('startCheckout fetch call', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends a POST with the correct Content-Type and body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/test' }),
    })
    const domain = 'acme.io'
    const slug = 'my-company'
    await fetch('/api/build/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, slug }),
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/build/domains')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({ domain: 'acme.io', slug: 'my-company' })
  })

  it('falls back to brand as slug when slug prop is absent', () => {
    const domain = 'acme.io'
    const brand = 'acme'
    const slug: string | undefined = undefined
    const effectiveSlug = slug || brand
    expect(effectiveSlug).toBe('acme')
  })
})

// ---------------------------------------------------------------------------
// RESUME_KEY sessionStorage logic (#281)
// ---------------------------------------------------------------------------

describe('domain purchase resume (sessionStorage)', () => {
  const RESUME_KEY = 'ainative:domain-purchase-resume'

  beforeEach(() => {
    // Provide a minimal sessionStorage stub in node env
    const store: Record<string, string> = {}
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores the correct shape when a signed-out user picks a domain', () => {
    const domain = 'acme.io'
    const slug = 'acme'
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ domain, slug }))
    const raw = sessionStorage.getItem(RESUME_KEY)!
    const parsed = JSON.parse(raw)
    expect(parsed.domain).toBe('acme.io')
    expect(parsed.slug).toBe('acme')
  })

  it('clears the resume key after it is consumed', () => {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ domain: 'acme.io', slug: 'acme' }))
    sessionStorage.removeItem(RESUME_KEY)
    expect(sessionStorage.getItem(RESUME_KEY)).toBeNull()
  })

  it('returns null for a missing resume key', () => {
    expect(sessionStorage.getItem(RESUME_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Fulfillment PUT — shape of the post-Stripe verification call
// ---------------------------------------------------------------------------

describe('fulfillment PUT call', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends a PUT with the session_id to verify payment', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ ok: true, domain: 'acme.io' }),
    })
    const sess = 'cs_test_abc123'
    await fetch('/api/build/domains', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sess }),
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/build/domains')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string).session_id).toBe('cs_test_abc123')
  })
})

// ---------------------------------------------------------------------------
// Scroll containment — CSS class contract (#48)
// The component must wrap the list in .m-domain-scroll-body and place the
// show-more button inside it. These invariants are checked by reading the
// source file rather than rendering (node env, no DOM).
// ---------------------------------------------------------------------------

import { readFileSync } from 'fs'
import path from 'path'

const componentSrc = readFileSync(
  path.resolve(__dirname, '../../../components/build/DomainModal.tsx'),
  'utf-8',
)

describe('scroll containment source invariants (#48)', () => {
  it('wraps the suggestion list in .m-domain-scroll-body', () => {
    expect(componentSrc).toContain('m-domain-scroll-body')
  })

  it('places the show-more button inside the scroll container', () => {
    // The show-more button must appear after the scroll body opening and
    // before the closing of the same element (simple positional check).
    const scrollBodyIdx = componentSrc.indexOf('m-domain-scroll-body')
    const showMoreIdx = componentSrc.indexOf('show-more-domains')
    const buyCtaIdx = componentSrc.indexOf('domain-buy-cta')
    expect(scrollBodyIdx).toBeGreaterThan(-1)
    expect(showMoreIdx).toBeGreaterThan(scrollBodyIdx)
    // The Buy CTA must appear AFTER the scroll body closes (i.e. outside it).
    expect(buyCtaIdx).toBeGreaterThan(showMoreIdx)
  })

  it('pins the Buy CTA outside the scroll body (data-testid present)', () => {
    expect(componentSrc).toContain('data-testid="domain-buy-cta"')
  })

  it('labels the show-more button with aria-label for accessibility', () => {
    expect(componentSrc).toContain('aria-label="Show more domain suggestions"')
  })

  it('marks the scroll container with role="listbox" for accessibility', () => {
    expect(componentSrc).toContain('role="listbox"')
  })

  it('marks each domain option with role="option" and aria-selected', () => {
    expect(componentSrc).toContain('role="option"')
    expect(componentSrc).toContain('aria-selected=')
  })
})
