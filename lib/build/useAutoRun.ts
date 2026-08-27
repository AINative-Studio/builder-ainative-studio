'use client'

/**
 * useAutoRun (#340) — one small shared poll of GET /api/build/auto-mode so any
 * Live surface (the swarm card's live section, the per-company masthead ribbon)
 * can react to THIS company's Auto Mode run without each duplicating the fetch
 * loop the AutoModePanel already runs. Returns the run record (which carries
 * the recentEvents ring, #340) + live progress.
 *
 * Polls every 15s while mounted (same cadence as useLiveProof) and recomputes
 * progress from the wall clock on each poll — cheap, honest, and it converges
 * on 'not running' when a bounded window expires without a network round-trip
 * having to say so.
 */

import { useEffect, useState } from 'react'
import { runProgress, type AutoRun, type AutoRunProgress } from '@/lib/build/auto-mode'
import type { AutoRunEvent } from '@/lib/build/auto-run-activity'

export interface AutoRunState {
  run: AutoRun | null
  progress: AutoRunProgress
  /** The run's event trail (#340) — [] until events land. */
  events: AutoRunEvent[]
}

const POLL_MS = 15_000

export function useAutoRun(companyId: string): AutoRunState {
  const [run, setRun] = useState<AutoRun | null>(null)
  // Bumped on each poll so progress tracks the wall clock without a 1s ticker.
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!companyId) return
    let alive = true
    const load = () => {
      fetch(`/api/build/auto-mode?companyId=${encodeURIComponent(companyId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { run?: AutoRun | null } | null) => {
          if (!alive) return
          setRun(d?.run ?? null)
          setNowMs(Date.now())
        })
        .catch(() => { /* surfaces stay hidden on failure — never fake a run */ })
    }
    load()
    const id = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [companyId])

  return { run, progress: runProgress(run, nowMs), events: run?.recentEvents ?? [] }
}
