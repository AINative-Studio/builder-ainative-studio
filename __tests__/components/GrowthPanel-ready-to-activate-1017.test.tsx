// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { GrowthPanel } from '@/components/build/GrowthPanel'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1017 — the "ready to activate" state in the Growth panel.
 *
 * #1016's finding was that nobody ever opted into ad testing, and the panel's
 * only offer was abstract: pay $5-$50 upfront for a campaign that did not exist
 * yet. With #1017's auto-create, a completed build already HAS a real, PAUSED
 * campaign — so there is now a third, concrete state the panel must render:
 *
 *   campaignId present + NOT funded  →  "Your test campaign is ready —
 *                                        add credits to launch it."
 *
 * The three states and their distinguishing registry data:
 *   - no campaignId                → IDLE (the original pay-first offer)
 *   - campaignId, no fundedCents   → READY TO ACTIVATE  ← new in #1017
 *   - campaignId + fundedCents     → FUNDED (reporting)
 *
 * Properties under test: each state renders, the new state is NOT mistaken for
 * the funded one (the real pre-#1017 bug would be showing "funded $0.00"), the
 * prompt still leads to the SAME existing credits checkout (no second payment
 * path invented), and no plan-tier wording blocks a free-tier founder from the
 * prompt itself.
 */

let host: HTMLElement
let root: Root

function mountWith(status: Record<string, unknown>, props: Partial<React.ComponentProps<typeof GrowthPanel>> = {}) {
  ;(globalThis as any).fetch = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes('/growth/status') ? status : { ok: true }),
  }))
  return act(async () => {
    root.render(
      <GrowthPanel
        companyId="acme"
        companyName="Acme Logistics"
        unlocked
        onUpgrade={() => {}}
        {...props}
      />,
    )
  })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

const q = (sel: string) => host.querySelector(`[data-testid="${sel}"]`)

describe('GrowthPanel — ready-to-activate state (#1017)', () => {
  it('renders the ready-to-activate prompt when a campaign exists but is unfunded', async () => {
    await mountWith({ available: true, campaignId: 'camp_auto_1' })

    const prompt = q('growth-ready-to-activate')
    expect(prompt).not.toBeNull()
    // The founder must be told, in plain language, that the campaign is real
    // and already made for them — not asked to imagine one.
    expect(prompt!.textContent).toMatch(/ready/i)
    expect(prompt!.textContent).toMatch(/credit/i)
  })

  it('does NOT render the funded/reporting state for an unfunded campaign', async () => {
    await mountWith({ available: true, campaignId: 'camp_auto_1' })
    // The real pre-#1017 bug this guards: the panel keyed only on campaignId,
    // so an auto-created campaign would have shown "funded $0.00 / real Meta
    // budget $0.00/day" as though the founder had already paid.
    expect(q('growth-campaign-active')).toBeNull()
    expect(host.textContent).not.toContain('funded $0.00')
  })

  it('does NOT render the idle pay-first offer when a campaign already exists', async () => {
    await mountWith({ available: true, campaignId: 'camp_auto_1' })
    expect(q('growth-idle')).toBeNull()
  })

  it('offers a launch action that routes through the EXISTING credits checkout', async () => {
    await mountWith({ available: true, campaignId: 'camp_auto_1' })
    const btn = q('growth-activate-fund') as HTMLButtonElement | null
    expect(btn).not.toBeNull()

    await act(async () => { btn!.click() })
    const calls = ((globalThis as any).fetch as any).mock.calls.map((c: any[]) => String(c[0]))
    // The same ad-budget-checkout route the panel already used — #1017 adds no
    // second payment path, and the panel never activates a campaign itself.
    expect(calls.some((u: string) => u.includes('/api/build/growth/ad-budget-checkout'))).toBe(true)
  })

  it('still renders the funded reporting state once funding is recorded', async () => {
    await mountWith({ available: true, campaignId: 'camp_auto_1', fundedCents: 1000, realBudgetCents: 800, clicks: 12, cpcCents: 45 })
    expect(q('growth-campaign-active')).not.toBeNull()
    expect(q('growth-ready-to-activate')).toBeNull()
    expect(q('growth-clicks')!.textContent).toContain('12')
  })

  it('still renders the idle offer when no campaign exists at all', async () => {
    await mountWith({ available: true })
    expect(q('growth-idle')).not.toBeNull()
    expect(q('growth-ready-to-activate')).toBeNull()
  })

  it('shows the ready-to-activate prompt to a non-paid founder too (#1017: no tier gate on ads)', async () => {
    await mountWith({ available: true, campaignId: 'camp_auto_1' }, { unlocked: false })
    const prompt = q('growth-ready-to-activate')
    expect(prompt).not.toBeNull()
    // The prompt itself must not tell a free-tier founder to upgrade — buying
    // credits, not a plan upgrade, is what launches the campaign.
    expect(prompt!.textContent).not.toMatch(/paid plan required/i)
  })

  it('renders the honest unavailable note when the feature is not configured, regardless of campaign state', async () => {
    await mountWith({ available: false })
    expect(q('growth-disabled-note')).not.toBeNull()
    expect(q('growth-ready-to-activate')).toBeNull()
  })
})
