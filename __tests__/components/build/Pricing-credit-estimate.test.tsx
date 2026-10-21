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
 * #1213 — wires the previously-orphaned POST /api/credits/estimate (a real,
 * auth-gated proxy to AINative's live /v1/managed/estimate) to a minimal
 * consumer: a pre-commit "what will this cost" line on the Pricing screen,
 * shown before the founder picks a plan. Silent/best-effort on any failure —
 * never blocks the pricing screen itself.
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

async function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(React.createElement(Pricing)) })
  // Flush the estimate fetch's microtask chain.
  await act(async () => { await Promise.resolve() })
}

describe('Pricing screen — pre-commit credit estimate (#1213)', () => {
  it('shows the real estimated credit cost once /api/credits/estimate resolves', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/credits/estimate')) {
        return { ok: true, json: async () => ({ model: 'claude-sonnet-4', estimated_tokens: 16000, estimated_credits: 3.25, credits_available: 100, can_afford: true }) } as any
      }
      return { ok: true, json: async () => ({}) } as any
    }) as any

    await render()

    const line = host.querySelector('[data-testid="pricing-credit-estimate"]')
    expect(line).not.toBeNull()
    expect(line?.textContent).toMatch(/claude-sonnet-4/)
    expect(line?.textContent).toMatch(/3\.25 credits/)

    // Confirms the real contract the live backend expects (model + estimated_tokens).
    const call = (global.fetch as any).mock.calls.find((c: any[]) => String(c[0]).includes('/api/credits/estimate'))
    expect(call).toBeDefined()
    const sentBody = JSON.parse(call[1].body)
    expect(sentBody).toEqual({ model: 'claude-sonnet-4', estimated_tokens: 16000 })
  })

  it('renders nothing for the estimate when the proxy fails — never blocks the pricing screen', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'Authentication required' }) })) as any

    await render()

    expect(host.querySelector('[data-testid="pricing-credit-estimate"]')).toBeNull()
    // The rest of the screen still renders fine.
    expect(host.querySelector('[data-testid="pricing-usage-based-note"]')).not.toBeNull()
  })
})
