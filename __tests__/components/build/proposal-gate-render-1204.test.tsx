// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { buildProposal, systemPreview, type ProposalPlan } from '@/lib/build/proposal'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — ProposalGate (components/build/ProposalGate.tsx,
 * 191 lines, reached live via components/build/screens/Pricing.tsx <-
 * BuildApp.tsx) had zero test coverage. Per the component's own doc comment,
 * ALL proposal logic lives in lib/build/proposal.ts (buildProposal,
 * systemPreview, proposalStatusCounts) and lib/build/live-vs-planned.ts
 * (planFramingLine) — both already independently tested
 * (__tests__/lib/build/proposal.test.ts,
 * __tests__/lib/build/live-vs-planned.test.ts) — so this file verifies only
 * ProposalGate's own rendering/click-to-preview orchestration, using the
 * REAL pure functions (not mocked) to derive expected values rather than
 * guessing their output shape. SystemStatusBadge (an untested sibling, out
 * of scope here) is mocked at its real exported boundary.
 */

const h = vi.hoisted(() => ({ state: {} as Record<string, any> }))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: h.state }) }))
vi.mock('@/components/build/SystemStatusBadge', () => ({
  SystemStatusBadge: ({ provisioned }: { provisioned?: boolean }) =>
    React.createElement('span', { 'data-testid': 'stub-status-badge' }, provisioned ? 'live' : 'planned'),
}))

const PLAN: ProposalPlan = { id: 'pro', name: 'Pro', monthly: 49 }

function baseState(overrides: Record<string, any> = {}) {
  return { companyName: 'Acme Co', idea: 'A CRM for plumbers', sawPreview: false, appChatId: null, appSub: null, track: 'company', ...overrides }
}

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

describe('ProposalGate — real rendering/click-to-preview coverage (#1204)', () => {
  it('renders the real headline/subline/cost-line produced by the real buildProposal()', async () => {
    h.state = baseState()
    const expected = buildProposal({ companyName: h.state.companyName, idea: h.state.idea, plan: PLAN, sawPreview: h.state.sawPreview })
    const { ProposalGate } = await import('@/components/build/ProposalGate')
    render(React.createElement(ProposalGate, { plan: PLAN }))

    expect(host.querySelector('[data-testid="proposal-headline"]')?.textContent).toBe(expected.headline)
    expect(host.textContent).toContain(expected.subline)
    expect(host.querySelector('[data-testid="proposal-cost"]')?.textContent).toBe(expected.costLine)
  })

  it('passes the real alreadyCovered flag through to buildProposal, changing the real cost line', async () => {
    h.state = baseState()
    const { ProposalGate } = await import('@/components/build/ProposalGate')
    render(React.createElement(ProposalGate, { plan: PLAN, alreadyCovered: true }))

    const expectedCovered = buildProposal({ companyName: h.state.companyName, idea: h.state.idea, plan: PLAN, sawPreview: false, alreadyCovered: true })
    const expectedNotCovered = buildProposal({ companyName: h.state.companyName, idea: h.state.idea, plan: PLAN, sawPreview: false, alreadyCovered: false })
    expect(expectedCovered.costLine).not.toBe(expectedNotCovered.costLine)
    expect(host.querySelector('[data-testid="proposal-cost"]')?.textContent).toBe(expectedCovered.costLine)
  })

  it('shows the real app-preview iframe when a real appChatId is present, with the real /api/preview src', async () => {
    h.state = baseState({ appChatId: 'chat-123', appSub: 'acme-co' })
    const { ProposalGate } = await import('@/components/build/ProposalGate')
    render(React.createElement(ProposalGate, { plan: PLAN }))

    const iframe = host.querySelector('[data-testid="proposal-app-frame"]') as HTMLIFrameElement
    expect(iframe).not.toBeNull()
    expect(iframe.getAttribute('src')).toBe('/api/preview/chat-123?slug=acme-co')
  })

  it('falls back to the real /build/{slug} URL when there is genuinely no appChatId but a real appSub exists', async () => {
    h.state = baseState({ appChatId: null, appSub: 'acme-co' })
    const { ProposalGate } = await import('@/components/build/ProposalGate')
    render(React.createElement(ProposalGate, { plan: PLAN }))

    const iframe = host.querySelector('[data-testid="proposal-app-frame"]') as HTMLIFrameElement
    expect(iframe.getAttribute('src')).toBe('/build/acme-co')
  })

  it('shows the real honest fallback placeholder (never a fabricated preview) when there is genuinely neither appChatId nor appSub', async () => {
    h.state = baseState({ appChatId: null, appSub: null, companyName: '' })
    const { ProposalGate } = await import('@/components/build/ProposalGate')
    render(React.createElement(ProposalGate, { plan: PLAN }))

    expect(host.querySelector('[data-testid="proposal-app-fallback"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="proposal-app-frame"]')).toBeNull()
  })

  it('defaults the open click-to-preview panel to the real FIRST proposed system', async () => {
    h.state = baseState()
    const expected = buildProposal({ companyName: h.state.companyName, idea: h.state.idea, plan: PLAN, sawPreview: false })
    const firstPreview = systemPreview(expected.systems[0])
    const { ProposalGate } = await import('@/components/build/ProposalGate')
    render(React.createElement(ProposalGate, { plan: PLAN }))

    expect(host.querySelector('[data-testid="proposal-preview-title"]')?.textContent).toBe(`${firstPreview.name} · ${firstPreview.title}`)
    const firstRow = host.querySelector(`[data-testid="proposal-system-${expected.systems[0].key}"]`)
    expect(firstRow?.getAttribute('aria-expanded')).toBe('true')
  })

  it('a real click on a different system row switches the real open preview to that system', async () => {
    h.state = baseState()
    const expected = buildProposal({ companyName: h.state.companyName, idea: h.state.idea, plan: PLAN, sawPreview: false })
    if (expected.systems.length < 2) throw new Error('test fixture needs at least 2 proposed systems to exercise this')
    const secondSystem = expected.systems[1]
    const secondPreview = systemPreview(secondSystem)

    const { ProposalGate } = await import('@/components/build/ProposalGate')
    render(React.createElement(ProposalGate, { plan: PLAN }))

    const secondRow = host.querySelector(`[data-testid="proposal-system-${secondSystem.key}"]`) as HTMLButtonElement
    await act(async () => { secondRow.click() })

    expect(host.querySelector('[data-testid="proposal-preview-title"]')?.textContent).toBe(`${secondPreview.name} · ${secondPreview.title}`)
    expect(secondRow.getAttribute('aria-expanded')).toBe('true')
  })

  it('renders the real system rows with the real whatItDoes copy and the (mocked) SystemStatusBadge', async () => {
    h.state = baseState()
    const expected = buildProposal({ companyName: h.state.companyName, idea: h.state.idea, plan: PLAN, sawPreview: false })
    const { ProposalGate } = await import('@/components/build/ProposalGate')
    render(React.createElement(ProposalGate, { plan: PLAN }))

    for (const s of expected.systems) {
      const row = host.querySelector(`[data-testid="proposal-system-${s.key}"]`)
      expect(row?.textContent).toContain(s.whatItDoes)
    }
    expect(host.querySelectorAll('[data-testid="stub-status-badge"]').length).toBe(expected.systems.length)
  })

  it('renders the real preview table columns/rows for the currently-open system', async () => {
    h.state = baseState()
    const expected = buildProposal({ companyName: h.state.companyName, idea: h.state.idea, plan: PLAN, sawPreview: false })
    const firstPreview = systemPreview(expected.systems[0])
    const { ProposalGate } = await import('@/components/build/ProposalGate')
    render(React.createElement(ProposalGate, { plan: PLAN }))

    const table = host.querySelector('[data-testid="proposal-preview-table"]') as HTMLTableElement
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent)
    expect(headers).toEqual(firstPreview.columns)
    expect(table.querySelectorAll('tbody tr').length).toBe(firstPreview.rows.length)
  })
})
