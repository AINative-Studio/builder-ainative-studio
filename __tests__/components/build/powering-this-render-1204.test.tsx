// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { PoweringThis } from '@/components/build/PoweringThis'
import { CATALOG_SIZE } from '@/lib/build/primitives'
import { getPrimitiveTooltip, selectPrimitives } from '@/lib/build/primitive-catalog'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — PoweringThis (components/build/PoweringThis.tsx,
 * 102 lines, reached live via components/build/screens/Workspace.tsx) had
 * zero test coverage. lib/build/primitive-catalog.ts's functions
 * (selectPrimitives, getPrimitiveTooltip) are already extensively
 * independently tested — used here REAL, not mocked, since they're
 * deterministic and this component's own blending logic depends on their
 * real output.
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

describe('PoweringThis — real chip-blending/tooltip/counter coverage (#1204)', () => {
  it('genuinely renders nothing for a view with no real PRIMITIVE_MAP entry and no idea', () => {
    render(React.createElement(PoweringThis, { view: 'totally-unknown-view' }))
    expect(host.innerHTML).toBe('')
  })

  it('renders the real view-specific chips from PRIMITIVE_MAP (brief: ZeroMemory, GraphRAG) with no idea given', () => {
    render(React.createElement(PoweringThis, { view: 'brief' }))
    expect(host.textContent).toContain('ZeroMemory')
    expect(host.textContent).toContain('GraphRAG')
    expect(host.textContent).toContain('Powering this')
  })

  it('renders a real catalog tooltip (title attribute + real tooltip span) for a chip with a known catalog entry', () => {
    render(React.createElement(PoweringThis, { view: 'brief' }))
    const zeroMemoryChip = Array.from(host.querySelectorAll('.m-chip')).find((el) => el.textContent === 'ZeroMemory') as HTMLElement

    const realTooltip = getPrimitiveTooltip('ZeroMemory')
    expect(realTooltip).toBeTruthy()
    expect(zeroMemoryChip.className).toContain('m-chip-hastooltip')
    expect(zeroMemoryChip.getAttribute('title')).toBe(`${realTooltip} — yours, on your own API.`)
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain(realTooltip!)
  })

  it('renders a plain chip (no tooltip wiring) for a real chip with no catalog entry — the component\'s own documented GraphRAG case', () => {
    expect(getPrimitiveTooltip('GraphRAG')).toBeFalsy()
    render(React.createElement(PoweringThis, { view: 'brief' }))

    const graphRagChip = Array.from(host.querySelectorAll('span')).find((el) => el.textContent === 'GraphRAG') as HTMLElement
    expect(graphRagChip.className).toBe('m-chip')
    expect(graphRagChip.hasAttribute('title')).toBe(false)
    expect(graphRagChip.closest('.m-chip-wrap')).toBeNull()
  })

  it('blends real idea-selected primitives in AFTER the real view-specific ones, deduped, when an idea is genuinely given', () => {
    const idea = 'An online store selling handmade candles with subscription boxes'
    const { names: ideaNames } = selectPrimitives(idea, 'company', 4)
    render(React.createElement(PoweringThis, { view: 'brief', idea }))

    const chipLabels = Array.from(host.querySelectorAll('.m-chip, .m-chip-wrap .m-chip')).map((el) => el.textContent)
    expect(chipLabels[0]).toBe('ZeroMemory')
    expect(chipLabels[1]).toBe('GraphRAG')
    // Every real idea-selected name not already in the view's base list
    // should appear somewhere after the two base chips.
    const newIdeaNames = ideaNames.filter((n) => !['zeromemory', 'graphrag'].includes(n.toLowerCase()))
    newIdeaNames.forEach((n) => expect(chipLabels).toContain(n))
  })

  it('never shows the counter chip when showCounter is genuinely false (the default)', () => {
    render(React.createElement(PoweringThis, { view: 'brief' }))
    expect(host.querySelector('.m-chip-counter')).toBeNull()
  })

  it('shows the real "N/CATALOG_SIZE woven" counter with the real CATALOG_SIZE when showCounter is genuinely true', () => {
    render(React.createElement(PoweringThis, { view: 'brief', showCounter: true }))
    const counter = host.querySelector('.m-chip-counter') as HTMLElement
    expect(counter.textContent).toBe(`2/${CATALOG_SIZE} woven`)
    expect(counter.getAttribute('title')).toBe(`${CATALOG_SIZE} primitives in the catalog`)
  })

  it('caps the real blended chip list at 8, even when the view + idea-selected union would exceed it', () => {
    const idea = 'A fintech marketplace with payments, invoicing, CRM, voice support, live streaming, and a full cap table'
    render(React.createElement(PoweringThis, { view: 'comp', idea, showCounter: true }))

    const counter = host.querySelector('.m-chip-counter') as HTMLElement
    const shownCount = Number(counter.textContent?.split('/')[0])
    expect(shownCount).toBeLessThanOrEqual(8)
  })
})
