'use client'

/**
 * GrowthPanel test harness — /test-components/growth-panel
 *
 * Mounts GrowthPanel in isolation (#1017 verification) so Playwright can check
 * the three real states without a signed-in founder, a provisioned company, or
 * — critically — any Stripe/Meta call. `/api/build/growth/status` is
 * intercepted client-side; the checkout POST is intercepted too and NEVER
 * reaches the real route, so no payment flow can be started from here.
 *
 *   ?state=ready   (default) campaign auto-created, unfunded → the #1017
 *                  "ready to activate" prompt
 *   ?state=idle    no campaign at all → the original pay-first offer
 *   ?state=funded  campaign + funding → the reporting view
 *   ?state=off     feature unavailable → the honest disabled note
 *   &unlocked=0    render as a FREE-TIER founder (the #1017 no-tier-gate case)
 */

import { useEffect, useState } from 'react'
import { GrowthPanel } from '@/components/build/GrowthPanel'
import '@/app/modernist.css'

const STATES: Record<string, Record<string, unknown>> = {
  ready: { available: true, campaignId: 'camp_auto_1017' },
  idle: { available: true },
  funded: {
    available: true,
    campaignId: 'camp_auto_1017',
    fundedCents: 1000,
    realBudgetCents: 800,
    clicks: 12,
    cpcCents: 45,
    insightsSyncedAt: new Date().toISOString(),
  },
  off: { available: false },
}

export default function GrowthPanelTestPage() {
  const [ready, setReady] = useState(false)
  const [unlocked, setUnlocked] = useState(true)
  const [lastCheckout, setLastCheckout] = useState<string | null>(null)
  const [upgradeClicked, setUpgradeClicked] = useState(false)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const status = STATES[q.get('state') || 'ready'] ?? STATES.ready
    setUnlocked(q.get('unlocked') !== '0')

    const origFetch = window.fetch.bind(window)
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/build/growth/status')) {
        return new Response(JSON.stringify(status), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // Stubbed, never forwarded: this harness must not be able to start a
      // real Stripe checkout. Records the request so the prompt's wiring can be
      // verified without any money moving.
      if (url.includes('/api/build/growth/ad-budget-checkout')) {
        setLastCheckout(String(init?.body || ''))
        return new Response(JSON.stringify({ ok: false, reason: 'harness_stub' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/api/build/growth/ad-insights')) {
        return new Response(JSON.stringify({ ok: true, clicks: 14, cpcCents: 42 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return origFetch(input, init)
    }) as typeof window.fetch
    setReady(true)
    return () => {
      window.fetch = origFetch
    }
  }, [])

  if (!ready) return null

  return (
    <div className="modernist" style={{ minHeight: '100vh', background: '#f5f4f2', padding: 24 }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <GrowthPanel
          companyId="test-co"
          companyName="Acme Logistics"
          unlocked={unlocked}
          onUpgrade={() => setUpgradeClicked(true)}
        />
        {lastCheckout && (
          <p data-testid="harness-last-checkout" style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 16 }}>
            {lastCheckout}
          </p>
        )}
        {upgradeClicked && (
          <p data-testid="harness-upgrade-clicked" style={{ fontFamily: 'monospace', fontSize: 11 }}>
            onUpgrade fired
          </p>
        )}
      </div>
    </div>
  )
}
