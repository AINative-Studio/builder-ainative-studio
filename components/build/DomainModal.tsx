'use client'

/**
 * Custom-domain modal (#207 · FIX-3) — the paid "get a real domain" step.
 * Searches real Namecheap availability for the brand across TLDs and lets the
 * user pick one. Purchase is gated server-side (auth + confirm). When Namecheap
 * isn't configured, it honestly says so rather than faking availability.
 *
 * #280 — the founder can also type an EXACT domain to check (search box) and pull
 *   more suggestions beyond the first batch ("More options →").
 * #281 — signed-out purchase no longer dead-ends: ONE primary CTA per auth state.
 *   Signed out → "Sign in to buy X" that actually routes into auth (via the
 *   optional onRequireAuth callback from Live); the picked domain+slug is stashed
 *   in sessionStorage so the purchase RESUMES to Stripe checkout after sign-in.
 * #48  — scroll containment: suggestion list is constrained to a fixed
 *   max-height with overflow-y:auto so the modal never grows past the viewport.
 *   Search input and Buy CTA stay pinned outside the scrollable area so they
 *   remain reachable regardless of result count. "Show more" sits at the bottom
 *   of the scrollable list so fetching the next batch is one scroll away.
 */

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'

interface Suggestion { domain: string; available: boolean; price?: number }

// sessionStorage key holding the domain a signed-out founder chose to buy, so the
// purchase resumes to Stripe checkout after they authenticate and land back on Live.
const RESUME_KEY = 'ainative:domain-purchase-resume'

export function DomainModal({ brand, slug, keywords, open, onClose, onRequireAuth }: {
  brand: string; slug?: string; keywords?: string; open: boolean; onClose: () => void
  // Optional so Live compiles without wiring it. When provided, a signed-out Buy
  // routes into auth (e.g. dispatch GOTO_SCREEN 'signup'); when absent we fall back
  // to next-auth's hosted sign-in page. Either way the pick is persisted to resume.
  onRequireAuth?: () => void
}) {
  const { status: sessionStatus } = useSession()
  const signedIn = sessionStatus === 'authenticated'

  const [loading, setLoading] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [moreLoading, setMoreLoading] = useState(false)
  const [moreExhausted, setMoreExhausted] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)

  // Merge helper — de-dup by domain so search results / more-options never double up.
  const mergeSuggestions = useCallback((prev: Suggestion[], next: Suggestion[]) => {
    const seen = new Set(prev.map((s) => s.domain))
    return [...prev, ...next.filter((s) => !seen.has(s.domain))]
  }, [])

  // Initial suggestions when the modal opens.
  useEffect(() => {
    if (!open || !brand) return
    setLoading(true); setStatus(null); setPicked(null)
    setOffset(0); setMoreExhausted(false); setQuery('')
    // Pass the company context so a taken bare word still surfaces on-brand
    // alternatives (embercoffee, drinkember, ember.shop…), not a dead end.
    const kw = keywords ? `&keywords=${encodeURIComponent(keywords)}` : ''
    fetch(`/api/build/domains?brand=${encodeURIComponent(brand)}${kw}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setConfigured(d?.configured !== false)
        const s: Suggestion[] = d?.suggestions || []
        setSuggestions(s)
        setOffset(s.length)
        if (s.length === 0) setMoreExhausted(true)
      })
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false))
  }, [open, brand, keywords])

  // "Show more domains" — pull the next batch of ranked suggestions (#280 / #48).
  // Sits inside the scrollable list so it's always reachable after scrolling down.
  const loadMore = useCallback(() => {
    if (moreLoading || moreExhausted || !brand) return
    setMoreLoading(true); setStatus(null)
    const kw = keywords ? `&keywords=${encodeURIComponent(keywords)}` : ''
    fetch(`/api/build/domains?brand=${encodeURIComponent(brand)}${kw}&offset=${offset}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const next: Suggestion[] = d?.suggestions || []
        if (next.length === 0) { setMoreExhausted(true); return }
        setSuggestions((prev) => mergeSuggestions(prev, next))
        setOffset((o) => o + next.length)
      })
      .catch(() => setMoreExhausted(true))
      .finally(() => setMoreLoading(false))
  }, [brand, keywords, offset, moreLoading, moreExhausted, mergeSuggestions])

  // Exact-domain search (#280) — check what the founder actually typed.
  const runSearch = useCallback((e?: React.FormEvent) => {
    e?.preventDefault()
    const q = query.trim()
    if (!q || searching) return
    setSearching(true); setStatus(null)
    fetch(`/api/build/domains?check=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setConfigured(d?.configured !== false)
        const results: Suggestion[] = d?.suggestions || []
        if (results.length === 0) {
          setStatus(d?.note || `Couldn't check ${q} — try a different spelling.`)
          return
        }
        // Surface the exact match's status, then merge available options to the top.
        const exact = results[0]
        if (exact && !exact.available) {
          setStatus(`${exact.domain} is taken — here are close available options.`)
        }
        const avail = results.filter((s) => s.available)
        if (avail.length === 0) {
          setStatus(`${q} and its close variants are all taken — try another name.`)
          return
        }
        // Put the fresh available results first so the founder sees them immediately.
        setSuggestions((prev) => mergeSuggestions(avail, prev))
        setPicked(avail[0].domain)
      })
      .catch(() => setStatus('Network error — try your search again.'))
      .finally(() => setSearching(false))
  }, [query, searching, mergeSuggestions])

  // Kick off checkout for `picked`. Extracted so it can run on mount (auth resume)
  // and from the Buy button. Returns nothing; drives status + redirect.
  const startCheckout = useCallback(async (domain: string) => {
    setStatus('Taking you to secure checkout for ' + domain + '…')
    try {
      const res = await fetch('/api/build/domains', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, slug: slug || brand }),
      })
      const d = await res.json()
      if (d?.url) { window.location.href = d.url; return }  // → Stripe Checkout
      if (d?.reason === 'signin') {
        // Shouldn't happen on the signed-in path, but degrade gracefully: re-arm resume.
        try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ domain, slug: slug || brand })) } catch {}
        setStatus('Please sign in to finish buying ' + domain + '.')
        return
      }
      setStatus(d?.error || d?.detail ? 'Could not start checkout: ' + (d.error || d.detail) : 'Could not start checkout for ' + domain + '.')
    } catch {
      setStatus('Network error — try again.')
    }
  }, [slug, brand])

  // Resume after auth (#281): if the founder picked a domain while signed out, we
  // stashed it; once they're authenticated and back on Live, pick up where we left
  // off and go straight to Stripe checkout for the SAME domain.
  useEffect(() => {
    if (!signedIn) return
    let pending: { domain?: string; slug?: string } | null = null
    try {
      const raw = sessionStorage.getItem(RESUME_KEY)
      if (raw) pending = JSON.parse(raw)
    } catch { pending = null }
    if (pending?.domain) {
      try { sessionStorage.removeItem(RESUME_KEY) } catch {}
      setPicked(pending.domain)
      startCheckout(pending.domain)
    }
  }, [signedIn, startCheckout])

  // Fulfillment: after Stripe redirects back with ?domain_session=…, verify the
  // payment and register + point DNS. Runs once regardless of modal open state.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sess = params.get('domain_session')
    if (!sess) return
    // strip the param so a refresh doesn't re-fulfill
    const clean = new URL(window.location.href); clean.searchParams.delete('domain_session')
    window.history.replaceState({}, '', clean.toString())
    setStatus('Finishing your domain purchase…')
    fetch('/api/build/domains', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sess }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) setStatus('✓ ' + (d.domain || 'Your domain') + ' is live — it now points at your site (DNS may take a few minutes).')
        else if (d?.registered) setStatus('✓ ' + (d.domain || 'Domain') + ' registered — DNS is propagating.')
        else setStatus(d?.detail || d?.error || 'Payment received — finishing setup.')
      })
      .catch(() => setStatus('Payment received — finishing domain setup shortly.'))
  }, [])

  if (!open) return null

  // The single Buy action. Signed in → checkout. Signed out → persist the pick and
  // route into auth (onRequireAuth if wired, else next-auth's hosted sign-in), so the
  // purchase RESUMES on return. No dead text + no looping enabled button (#281).
  const onBuy = () => {
    if (!picked) return
    if (signedIn) { startCheckout(picked); return }
    try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ domain: picked, slug: slug || brand })) } catch {}
    if (onRequireAuth) { onRequireAuth(); return }
    // Fallback when Live didn't pass a handler: next-auth hosted sign-in, returning
    // to this company's Live page where the resume effect completes the purchase.
    const back = `/build/${encodeURIComponent(slug || brand)}`
    window.location.href = `/api/auth/signin?callbackUrl=${encodeURIComponent(back)}`
  }

  const buyLabel = !picked
    ? 'Pick a domain'
    : signedIn
      ? `Buy ${picked} →`
      : `Sign in to buy ${picked} →`

  return (
    <div className="m-modal-scrim" role="dialog" aria-modal="true" aria-label="Get a custom domain">
      <div className="m-modal m-formin">
        <p className="m-mono m-modal-eyebrow"><span className="m-glyph">◇</span> Cody · custom domain</p>
        <h2 className="m-artifact m-modal-h">Give {brand} a real address</h2>
        {!configured ? (
          <p className="m-sub">Custom-domain purchasing isn&apos;t enabled yet. Your site is already live at
            builder.ainative.studio/build/{brand} — you can add a domain later.</p>
        ) : loading ? (
          <p className="m-sub">Checking what&apos;s available for <strong>{brand}</strong>…</p>
        ) : (
          <>
            {/* Search input — pinned above the scrollable list so it's always visible (#48). */}
            <form className="m-domain-search" onSubmit={runSearch} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input
                className="m-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a domain you want (e.g. myname.com)…"
                aria-label="Search for a specific domain"
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn-secondary" disabled={!query.trim() || searching}>
                {searching ? 'Checking…' : 'Check'}
              </button>
            </form>

            {/*
             * Scroll-contained body (#48): the list + show-more button live inside
             * this fixed-height, overflow-y:auto wrapper. The search form above and
             * the Buy CTA below remain outside so they're always on-screen.
             */}
            <div
              className="m-domain-scroll-body"
              role="listbox"
              aria-label="Available domains"
              data-testid="domain-scroll-body"
            >
              <div className="m-domain-list">
                {suggestions.map((s) => (
                  <button
                    key={s.domain}
                    className={`m-domain-opt ${picked === s.domain ? 'is-picked' : ''}`}
                    onClick={() => setPicked(s.domain)}
                    role="option"
                    aria-selected={picked === s.domain}
                  >
                    <span className="m-domain-name">{s.domain}</span>
                    <span className="m-domain-price m-mono">
                      {typeof s.price === 'number' ? `$${s.price % 1 === 0 ? s.price : s.price.toFixed(2)}/yr` : 'available'}
                    </span>
                  </button>
                ))}
                {suggestions.length === 0 && (
                  <p className="m-sub">Every {brand} variation is taken right now. Search a specific domain above (or ask Cody for another) and I&apos;ll find you a great available address.</p>
                )}
              </div>

              {/* Show more — inside the scroll body so it's reachable after scrolling (#48). */}
              {suggestions.length > 0 && !moreExhausted && (
                <div className="m-domain-more-row">
                  <button
                    className="m-back"
                    onClick={loadMore}
                    disabled={moreLoading}
                    aria-label="Show more domain suggestions"
                    data-testid="show-more-domains"
                  >
                    {moreLoading ? 'Finding more…' : 'Show more domains'}
                  </button>
                </div>
              )}
            </div>

            {/* Status message — below scroll body, above CTA */}
            {status && <p className="m-mono m-domain-status" role="status">{status}</p>}

            {/* Buy CTA — pinned outside the scroll body, always reachable (#48 / #281). */}
            <div className="m-modal-opts" style={{ marginTop: 8 }}>
              <button
                className="btn-primary"
                disabled={!picked}
                onClick={onBuy}
                data-testid="domain-buy-cta"
              >
                {buyLabel}
              </button>
            </div>
          </>
        )}
        <p className="m-mono m-modal-foot"><button className="m-back" onClick={onClose}>Close</button></p>
      </div>
    </div>
  )
}
