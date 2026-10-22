'use client'

/**
 * Live proof (social proof) — reads the public platform-intelligence endpoint
 * that powers ainative.studio/intelligence, so Builder shows the REAL 24/7
 * agent-led loop as proof: "we build AINative live; you can too, same infra."
 * (Toby's directive — weave /intelligence data into the pivot UX.)
 *
 * Public endpoint, no auth: GET /api/v1/public/platform/intelligence.
 * Falls back to null (component hides the strip) rather than blocking render.
 *
 * #1257: a transient 503 was observed in production sandwiched between two
 * otherwise-successful polls of /api/build/intelligence. The route handler
 * itself (app/api/build/intelligence/route.ts) always returns 200 on every
 * code path it controls — success or upstream failure — so a 503 reaching
 * the browser did not originate from this route's own logic; it reads as an
 * infra-level blip in front of the handler (edge/cold-start) rather than a
 * server-side bug. The poll loop below already self-heals within 15s since
 * a non-ok response just leaves the strip showing stale numbers, but a one-
 * shot retry on a transient (5xx/network) failure closes the gap further
 * with no added risk, so it's added here defensively.
 */

import { useEffect, useState } from 'react'

export interface LiveProof {
  agentsActive: number | null
  tasksToday: number | null
  apiRequestsToday: string | null
  companiesBuilt: number | null
}

// Same-origin proxy — the upstream api.ainative.studio endpoint sends NO CORS
// headers, so a direct browser fetch is blocked. /api/build/intelligence proxies
// it server-side so the real numbers actually reach the client (#207 CRUSH-2).
const INTELLIGENCE_URL = '/api/build/intelligence'

export function useLiveProof(): LiveProof {
  const [proof, setProof] = useState<LiveProof>({
    agentsActive: null, tasksToday: null, apiRequestsToday: null, companiesBuilt: null,
  })

  useEffect(() => {
    let alive = true
    const ac = new AbortController()

    // One-shot retry on a transient (5xx) response — a 503 from an edge/
    // cold-start blip shouldn't cost a full 15s refresh cycle when a quick
    // second attempt would likely succeed. Client errors (4xx) and an
    // already-aborted signal are not retried.
    const fetchOnce = () => fetch(INTELLIGENCE_URL, { signal: ac.signal })
    const fetchWithRetry = async (): Promise<Response> => {
      const res = await fetchOnce()
      if (res.ok || !(res.status >= 500) || !alive) return res
      await new Promise((r) => setTimeout(r, 500))
      if (!alive || ac.signal.aborted) return res
      return fetchOnce()
    }

    const load = () => {
      fetchWithRetry()
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive || !d) return
          const s = d.stats || {}
          setProof({
            agentsActive: num(s.agents_active),
            tasksToday: num(s.tasks_completed_24h ?? s.tasks_completed_today),
            apiRequestsToday: s.api_requests_today ?? null,
            companiesBuilt: num(s.total_companies ?? s.companies),
          })
        })
        .catch(() => { /* strip hides on failure */ })
    }
    load()
    // Live spectacle: refresh every 15s so the numbers visibly move — the real
    // recursive loop working, not a static badge (the Polsia-style "watch it live").
    const id = setInterval(load, 15_000)
    return () => { alive = false; ac.abort(); clearInterval(id) }
  }, [])

  return proof
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? Math.round(n) : null
}
