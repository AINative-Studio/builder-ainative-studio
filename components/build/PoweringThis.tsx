'use client'

/** "Powering this" strip (#221) — the ONLY primitive-surfacing mechanism. 05-COMPONENTS. */

import { PRIMITIVE_MAP } from '@/lib/build/primitives'

export function PoweringThis({ view }: { view: string }) {
  const entry = PRIMITIVE_MAP[view]
  if (!entry || entry.powered.length === 0) return null
  return (
    <div className="m-powering">
      <span className="m-powering-label m-mono">Powering this</span>
      <div className="m-powering-chips">
        {entry.powered.map((p) => <span key={p} className="m-chip">{p}</span>)}
      </div>
    </div>
  )
}
