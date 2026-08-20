'use client'

/**
 * Terminal ribbon (#207 · 03-FLOW Act 2) — the dark, mono, scrolling strip that
 * narrates infra-level actions while Cody builds ("provision ▸ zerodb…",
 * "agent:backend ▸ scaffolding /ask endpoint"). Fed by state.ribbon, appended
 * to by useAutoplay during swarm/infra/preview phases. Hidden when there are no
 * lines and no active build.
 */

import { useEffect, useRef } from 'react'
import { useBuild } from '@/contexts/build-context'

export function TerminalRibbon() {
  const { state } = useBuild()
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [state.ribbon.length])

  if (!state.ribbon.length) return null
  const recent = state.ribbon.slice(-6)

  return (
    <div className="m-ribbon m-mono" role="log" aria-label="Build activity">
      {recent.map((line, i) => (
        <div key={state.ribbon.length - recent.length + i} className="m-ribbon-line m-linein">
          <span className="m-ribbon-caret">›</span> {line}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
