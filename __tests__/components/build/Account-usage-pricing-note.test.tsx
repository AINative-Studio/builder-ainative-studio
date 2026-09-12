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
 * #653 — the Usage this month section shows consumption against plan limits
 * with no seat line item (already true structurally), but never stated that
 * plans are priced on usage rather than seats. Adds an explicit, durable
 * ("current plans", not a permanent promise) claim.
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Toby', email: 'toby@ainative.studio' } } }),
  signOut: vi.fn(),
}))
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: { activePlan: 'pro', appSub: 'ember-box', companyName: 'Ember Box', track: 'company' }, dispatch: vi.fn() }),
}))
vi.mock('@/lib/build/account-session', () => ({
  isGuestSession: () => false,
  getDisplayName: () => 'Toby',
  getDisplayEmail: () => 'toby@ainative.studio',
}))
vi.mock('@/components/build/SettingsForm', () => ({ SettingsForm: () => null }))
vi.mock('@/components/build/DangerZone', () => ({ DangerZone: () => null }))

import { Account } from '@/components/build/screens/Account'

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function flush() {
  return act(async () => { await Promise.resolve(); await Promise.resolve() })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('Account usage section — usage-based pricing note (#653)', () => {
  it('states plans bill on usage, not seats, with no seat line item anywhere in the usage section', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any
    render(React.createElement(Account))
    await flush()

    const note = host.querySelector('[data-testid="account-usage-pricing-note"]')
    expect(note).not.toBeNull()
    expect(note?.textContent).toMatch(/usage, not seats/i)

    const usageSection = host.querySelector('[data-testid="account-usage-section"]')
    expect(usageSection?.textContent).not.toMatch(/per seat|seat fee|\$\/seat/i)
  })
})
