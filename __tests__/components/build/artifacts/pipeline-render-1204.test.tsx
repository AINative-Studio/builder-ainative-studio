// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Pipeline } from '@/components/build/artifacts/Pipeline'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — Pipeline (components/build/artifacts/Pipeline.tsx,
 * 48 lines, reached live via components/build/ArtifactRouter.tsx's
 * 'pipeline' registry entry — the same real view-key registry pattern
 * already covered for DesignPicker/Conflict/Wedge/RescopeIntent) had zero
 * test coverage.
 *
 * Found a real display bug while writing this: every column's total
 * genuinely renders as "$0k" because parseInt('$18k') returns NaN (parseInt
 * stops at the leading '$', a non-digit char), and `sum || 0` silently
 * coerces the NaN result to 0. Filed separately as issue #1445 per scope
 * discipline — this test asserts the REAL current output ($0k on every
 * column), not the intended-but-broken correct sum, so it won't mask a fix
 * later: once #1445 lands, these specific assertions will start failing and
 * must be updated to the real fixed totals at that point.
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

describe('Pipeline — real static kanban/agent rendering coverage (#1204)', () => {
  it('renders the real Scout and Closer agent cards with their real task text', () => {
    render(React.createElement(Pipeline))

    expect(host.textContent).toContain('◇ Scout')
    expect(host.textContent).toContain('Sourcing & qualifying leads')
    expect(host.textContent).toContain('◇ Closer')
    expect(host.textContent).toContain('Working 4 open deals')
  })

  it('renders all 4 real kanban columns in the real given order', () => {
    render(React.createElement(Pipeline))

    const headers = Array.from(host.querySelectorAll('.m-kan-head')).map((el) => el.textContent)
    expect(headers[0]).toContain('Qualified')
    expect(headers[1]).toContain('In conversation')
    expect(headers[2]).toContain('Proposal')
    expect(headers[3]).toContain('Closed won')
  })

  it('renders the real deal count per column header', () => {
    render(React.createElement(Pipeline))

    const headers = Array.from(host.querySelectorAll('.m-kan-head')).map((el) => el.textContent)
    expect(headers[0]).toContain('· 1 ·')
    expect(headers[1]).toContain('· 2 ·')
    expect(headers[2]).toContain('· 1 ·')
    expect(headers[3]).toContain('· 1 ·')
  })

  it('REAL BUG (filed as #1445): every column total renders as $0k due to parseInt(\'$18k\') => NaN', () => {
    render(React.createElement(Pipeline))

    const headers = Array.from(host.querySelectorAll('.m-kan-head')).map((el) => el.textContent)
    // Honest assertion of the CURRENT broken behavior, not the intended sum.
    headers.forEach((h) => expect(h).toContain('$0k'))
  })

  it('renders every real deal card with its company/value/next-step/agent, and marks the real won deal', () => {
    render(React.createElement(Pipeline))

    const deals = Array.from(host.querySelectorAll('.m-deal'))
    expect(deals).toHaveLength(5)

    const northwind = deals.find((d) => d.textContent?.includes('Northwind Ops'))
    expect(northwind?.textContent).toContain('$18k')
    expect(northwind?.textContent).toContain('Scout booked intro call')
    expect(northwind?.textContent).toContain('◇ Scout')
    expect(northwind?.className).not.toContain('is-won')

    const pike = deals.find((d) => d.textContent?.includes('Pike Manufacturing'))
    expect(pike?.className).toContain('is-won')
  })

  it('renders the real ZeroPipeline/Agent Cloud/ZeroInvoice attribution footer', () => {
    render(React.createElement(Pipeline))

    expect(host.textContent).toContain('ZeroPipeline')
    expect(host.textContent).toContain('Agent Cloud swarm')
    expect(host.textContent).toContain('ZeroInvoice')
  })
})
