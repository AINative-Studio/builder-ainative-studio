// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #653 — the Pricing screen states the "own 100% / cancel anytime" trust
 * line, but nothing said pricing is usage-based rather than seat-based. This
 * adds the claim in the same reassurance style, stated plainly rather than
 * buried in fine print, per the issue's own placement guidance.
 */

vi.mock('@/components/analytics/google-analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/components/analytics/meta-pixel', () => ({ trackMeta: vi.fn() }))
vi.mock('@/components/build/ProposalGate', () => ({ ProposalGate: () => null }))

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { activePlan: '', companyName: 'Ember Box', appSub: 'ember-box', sawPreview: true, idea: 'an idea', track: 'company', appChatId: 'chat1' },
    dispatch: dispatchMock,
  }),
}))

import { Pricing } from '@/components/build/screens/Pricing'

let host: HTMLElement
let root: Root

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('Pricing screen — usage-based note (#653)', () => {
  it('states plans bill on usage, not seats, alongside the existing ownership reassurance line', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => { root.render(React.createElement(Pricing)) })

    const note = host.querySelector('[data-testid="pricing-usage-based-note"]')
    expect(note).not.toBeNull()
    expect(note?.textContent).toMatch(/usage, not seats/i)
  })
})
