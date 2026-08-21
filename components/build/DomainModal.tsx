'use client'

/**
 * Custom-domain modal (#207 · FIX-3) — the paid "get a real domain" step.
 * Searches real Namecheap availability for the brand across TLDs and lets the
 * user pick one. Purchase is gated server-side (auth + confirm). When Namecheap
 * isn't configured, it honestly says so rather than faking availability.
 */

import { useEffect, useState } from 'react'

interface Suggestion { domain: string; available: boolean; price?: number }

export function DomainModal({ brand, slug, keywords, open, onClose }: { brand: string; slug?: string; keywords?: string; open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !brand) return
    setLoading(true); setStatus(null); setPicked(null)
    // Pass the company context so a taken bare word still surfaces on-brand
    // alternatives (embercoffee, drinkember, ember.shop…), not a dead end.
    const kw = keywords ? `&keywords=${encodeURIComponent(keywords)}` : ''
    fetch(`/api/build/domains?brand=${encodeURIComponent(brand)}${kw}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setConfigured(d?.configured !== false)
        setSuggestions(d?.suggestions || [])
      })
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false))
  }, [open, brand, keywords])

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

  const claim = async () => {
    if (!picked) return
    setStatus('Taking you to secure checkout for ' + picked + '…')
    try {
      const res = await fetch('/api/build/domains', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: picked, slug: slug || brand }),
      })
      const d = await res.json()
      if (d?.url) { window.location.href = d.url; return }  // → Stripe Checkout
      if (d?.reason === 'signin') setStatus('Sign in to purchase ' + picked + ' →')
      else setStatus(d?.error || d?.detail ? 'Could not start checkout: ' + (d.error || d.detail) : 'Could not start checkout for ' + picked + '.')
    } catch {
      setStatus('Network error — try again.')
    }
  }

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
            <div className="m-domain-list">
              {/* Only AVAILABLE (purchasable) domains are returned — no dead options. */}
              {suggestions.map((s) => (
                <button
                  key={s.domain}
                  className={`m-domain-opt ${picked === s.domain ? 'is-picked' : ''}`}
                  onClick={() => setPicked(s.domain)}
                >
                  <span className="m-domain-name">{s.domain}</span>
                  <span className="m-domain-price m-mono">
                    {typeof s.price === 'number' ? `$${s.price % 1 === 0 ? s.price : s.price.toFixed(2)}/yr` : 'available'}
                  </span>
                </button>
              ))}
              {suggestions.length === 0 && (
                <p className="m-sub">Every {brand} variation is taken right now. Tweak the name a touch (or ask Cody for another) and I&apos;ll find you a great available address.</p>
              )}
            </div>
            {status && <p className="m-mono m-domain-status">{status}</p>}
            <div className="m-modal-opts" style={{ marginTop: 8 }}>
              <button className="btn-primary" disabled={!picked} onClick={claim}>
                {picked ? `Buy ${picked} →` : 'Pick a domain'}
              </button>
            </div>
          </>
        )}
        <p className="m-mono m-modal-foot"><button className="m-back" onClick={onClose}>Close</button></p>
      </div>
    </div>
  )
}
