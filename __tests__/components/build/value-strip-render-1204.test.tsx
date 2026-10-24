// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ValueStrip } from '@/components/build/ValueStrip'
import { FRONT_DOOR_STEPS } from '@/lib/build/front-door-value'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — ValueStrip (components/build/ValueStrip.tsx,
 * 27 lines, reached live via components/build/screens/Fork.tsx) had zero
 * test coverage. Uses the real FRONT_DOOR_STEPS from
 * lib/build/front-door-value.ts (already independently tested in
 * front-door-value.test.ts) rather than hand-guessing the step content.
 */

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
})

describe('ValueStrip — real FRONT_DOOR_STEPS rendering coverage (#1204)', () => {
  it('renders one real step element per real FRONT_DOOR_STEPS entry, in the real given order', () => {
    render(React.createElement(ValueStrip))

    const stepEls = Array.from(host.querySelectorAll('[data-testid^="value-step-"]'))
    expect(stepEls).toHaveLength(FRONT_DOOR_STEPS.length)
    FRONT_DOOR_STEPS.forEach((s, i) => {
      expect(stepEls[i].getAttribute('data-testid')).toBe(`value-step-${s.step}`)
    })
  })

  it('renders the real step number/label/detail text for every real step', () => {
    render(React.createElement(ValueStrip))

    FRONT_DOOR_STEPS.forEach((s) => {
      const el = host.querySelector(`[data-testid="value-step-${s.step}"]`) as HTMLElement
      expect(el.querySelector('.m-value-step-num')?.textContent).toBe(String(s.step))
      expect(el.querySelector('.m-value-step-label')?.textContent).toBe(s.label)
      expect(el.querySelector('.m-value-step-detail')?.textContent).toBe(s.detail)
    })
  })

  it('has the real accessibility label on the strip container', () => {
    render(React.createElement(ValueStrip))

    expect(host.querySelector('[data-testid="value-strip"]')?.getAttribute('aria-label')).toBe('How Builder works — 3 steps')
  })
})
