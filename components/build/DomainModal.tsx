'use client'

/**
 * Custom-domain modal (#207 · FIX-3) — the paid "get a real domain" step.
 * Searches real Namecheap availability for the brand across TLDs and lets the
 * user pick one. Purchase is gated server-side (auth + confirm). When Namecheap
 * isn't configured, it honestly says so rather than faking availability.
 */

import { useEffect, useState } from 'react'

interface Suggestion { domain: string; available: boolean }

export function DomainModal({ brand, open, onClose }: { brand: string; open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !brand) return
    setLoading(true); setStatus(null); setPicked(null)
    fetch(`/api/build/domains?brand=${encodeURIComponent(brand)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setConfigured(d?.configured !== false)
        setSuggestions(d?.suggestions || [])
      })
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false))
  }, [open, brand])

  if (!open) return null

  const claim = async () => {
    if (!picked) return
    setStatus('Reserving ' + picked + '…')
    try {
      const res = await fetch('/api/build/domains', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: picked }),
      })
      const d = await res.json()
      if (d?.ok) setStatus('✓ ' + picked + ' is yours — Cody will point it at your site.')
      else if (d?.reason === 'not_confirmed' || d?.reason === 'signin') setStatus('Sign in to complete the purchase of ' + picked + '.')
      else setStatus(d?.error ? 'Could not claim ' + picked + ': ' + d.error : 'Could not claim ' + picked + '.')
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
              {suggestions.map((s) => (
                <button
                  key={s.domain}
                  className={`m-domain-opt ${picked === s.domain ? 'is-picked' : ''}`}
                  disabled={!s.available}
                  onClick={() => setPicked(s.domain)}
                >
                  <span className="m-domain-name">{s.domain}</span>
                  <span className={`m-domain-badge ${s.available ? 'is-free' : 'is-taken'}`}>
                    {s.available ? 'available' : 'taken'}
                  </span>
                </button>
              ))}
              {suggestions.length === 0 && <p className="m-sub">No suggestions — try a different brand.</p>}
            </div>
            {status && <p className="m-mono m-domain-status">{status}</p>}
            <div className="m-modal-opts" style={{ marginTop: 8 }}>
              <button className="btn-primary" disabled={!picked} onClick={claim}>
                {picked ? `Claim ${picked} →` : 'Pick a domain'}
              </button>
            </div>
          </>
        )}
        <p className="m-mono m-modal-foot"><button className="m-back" onClick={onClose}>Close</button></p>
      </div>
    </div>
  )
}
