'use client'

/**
 * Live-proof strip (#222 / social proof) — surfaces the real /intelligence loop
 * inside Builder's front door. Message: AINative is built 24/7, agent-led, live
 * — and you build on the same infrastructure.
 */

import { useLiveProof } from '@/lib/build/useLiveProof'

function fmt(n: number | null): string | null {
  if (n == null) return null
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

export function LiveProof() {
  const p = useLiveProof()
  const stats = [
    { label: 'agents working now', value: fmt(p.agentsActive), live: true },
    { label: 'agent tasks today', value: fmt(p.tasksToday), live: false },
    { label: 'companies built', value: fmt(p.companiesBuilt), live: false },
  ].filter((s) => s.value != null)

  if (stats.length === 0) return null

  return (
    <div className="m-proof">
      {stats.map((s) => (
        <div key={s.label} className="m-proof-stat">
          <div className="m-proof-num">
            {s.live && <span className="m-live-dot" aria-hidden />}
            {s.value}
          </div>
          <span className="m-proof-label">{s.label}</span>
        </div>
      ))}
      <p className="m-proof-tag">
        AINative is built in real time, 24/7, by its own agents — on the same
        infrastructure Cody uses to build yours.
      </p>
    </div>
  )
}
