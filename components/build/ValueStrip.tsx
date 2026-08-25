'use client'

/**
 * ValueStrip (#65) — the 3-step "what Builder does" strip shown on the front
 * door before any auth, so a first-time visitor understands within 5 seconds.
 *
 * Design: Modernist chrome, three numbered steps: idea → real app you own →
 * runs itself. Pure display; no side effects.
 */

import { FRONT_DOOR_STEPS } from '@/lib/build/front-door-value'

export function ValueStrip() {
  return (
    <div className="m-value-strip" data-testid="value-strip" aria-label="How Builder works — 3 steps">
      {FRONT_DOOR_STEPS.map(({ step, label, detail }) => (
        <div key={step} className="m-value-step" data-testid={`value-step-${step}`}>
          <span className="m-value-step-num m-mono">{step}</span>
          <div className="m-value-step-body">
            <strong className="m-value-step-label">{label}</strong>
            <span className="m-value-step-detail m-mono">{detail}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
