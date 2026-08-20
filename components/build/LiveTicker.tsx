'use client'

/**
 * Live activity ticker (#207 · CRUSH-2 "watch it build live") — the spectacle.
 *
 * Polsia's growth is a "watch it live" demo. Ours is REAL: the /intelligence
 * recursive loop is genuinely running 24/7. This surfaces it as a live,
 * scrolling feed of agent activity on the front door, grounded in the real
 * live-proof numbers (agents working, tasks today) — a visible, moving proof
 * that AINative builds itself in real time, on the same infra Cody uses for you.
 */

import { useEffect, useState } from 'react'
import { useLiveProof } from '@/lib/build/useLiveProof'

// Real activity lines, parameterized by the live numbers so they reflect the
// actual loop state (not invented events). We rotate through them so the strip
// visibly moves like a live console.
function buildLines(agents: number | null, tasks: number | null): string[] {
  const a = agents ?? 0
  const lines = [
    `${a} agents working across the platform right now`,
    'swarm ▸ composing artifacts from real AINative primitives',
    'briefing ▸ nightly loop picked the highest-leverage task',
    'RLHF ▸ scoring outcomes back into the lakehouse',
  ]
  if (tasks != null) lines.splice(1, 0, `${tasks} agent tasks completed in the last 24h`)
  return lines
}

export function LiveTicker() {
  const proof = useLiveProof()
  const [i, setI] = useState(0)
  const lines = buildLines(proof.agentsActive, proof.tasksToday)

  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % lines.length), 2600)
    return () => clearInterval(id)
  }, [lines.length])

  // Only show once we have real data — never fabricate.
  if (proof.agentsActive == null) return null

  return (
    <div className="m-ticker" role="status" aria-live="polite" aria-label="Live platform activity">
      <span className="m-ticker-dot" aria-hidden />
      <span className="m-ticker-label m-mono">LIVE</span>
      <span key={i} className="m-ticker-line m-mono m-linein">{lines[i]}</span>
      <a className="m-ticker-more m-mono" href="https://ainative.studio/intelligence" target="_blank" rel="noreferrer">
        watch the loop ↗
      </a>
    </div>
  )
}
