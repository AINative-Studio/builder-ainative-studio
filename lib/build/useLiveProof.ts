'use client'

/**
 * Live proof (social proof) — reads the public platform-intelligence endpoint
 * that powers ainative.studio/intelligence, so Builder shows the REAL 24/7
 * agent-led loop as proof: "we build AINative live; you can too, same infra."
 * (Toby's directive — weave /intelligence data into the pivot UX.)
 *
 * Public endpoint, no auth: GET /api/v1/public/platform/intelligence.
 * Falls back to null (component hides the strip) rather than blocking render.
 */

import { useEffect, useState } from 'react'

export interface LiveProof {
  agentsActive: number | null
  tasksToday: number | null
  apiRequestsToday: string | null
  companiesBuilt: number | null
}

const AINATIVE_API =
  process.env.NEXT_PUBLIC_AINATIVE_API_URL || 'https://api.ainative.studio'

export function useLiveProof(): LiveProof {
  const [proof, setProof] = useState<LiveProof>({
    agentsActive: null, tasksToday: null, apiRequestsToday: null, companiesBuilt: null,
  })

  useEffect(() => {
    let alive = true
    const ac = new AbortController()
    fetch(`${AINATIVE_API}/api/v1/public/platform/intelligence`, { signal: ac.signal })
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
    return () => { alive = false; ac.abort() }
  }, [])

  return proof
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? Math.round(n) : null
}
