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
 * #1204 (Coverage Phase 4) — company-artifacts.tsx (components/build/artifacts/
 * company-artifacts.tsx, 136 lines, reached live via components/build/
 * ArtifactRouter.tsx <- components/build/screens/Workspace.tsx) had zero test
 * coverage. 5 artifact bodies, each driven by useGenAutoRetry (NOT useGen —
 * the "never show broken for a never-generated view" variant). That hook is
 * already independently tested (__tests__/lib/build/gen-helpers.test.ts) —
 * mocked here at its real exported boundary so this file verifies only
 * company-artifacts.tsx's own per-view rendering of its real
 * {data, error, stuck, retrying, retry} shape. useBuild is mocked for Plan30's
 * real companyName display + dispatch call.
 */

const h = vi.hoisted(() => ({
  useGenAutoRetry: vi.fn(),
  dispatch: vi.fn(),
  state: { companyName: '' } as Record<string, any>,
}))
vi.mock('@/components/build/artifacts/gen-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/build/artifacts/gen-helpers')>()
  return { ...actual, useGenAutoRetry: h.useGenAutoRetry }
})
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: h.state, dispatch: h.dispatch }) }))

function pending() {
  return { data: null, error: null, stuck: false, retrying: false, retry: vi.fn() }
}
function stuck(retrying = false) {
  return { data: null, error: 'timeout', stuck: true, retrying, retry: vi.fn() }
}
function ready(data: any, error: string | null = null) {
  return { data, error, stuck: false, retrying: false, retry: vi.fn() }
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
  h.dispatch.mockClear()
  h.state = { companyName: '' }
})

describe('company-artifacts — real per-view generation-state rendering coverage (#1204)', () => {
  it('Thesis: shows the real shimmer while genuinely pending (not yet stuck)', async () => {
    h.useGenAutoRetry.mockReturnValue(pending())
    const { Thesis } = await import('@/components/build/artifacts/company-artifacts')
    render(React.createElement(Thesis))
    expect(host.textContent).toContain('Cody is drafting this from your idea')
  })

  it('Thesis: shows the real calm GenStuck state (never a raw error) once genuinely stuck with no data', async () => {
    h.useGenAutoRetry.mockReturnValue(stuck())
    const { Thesis } = await import('@/components/build/artifacts/company-artifacts')
    render(React.createElement(Thesis))
    expect(host.textContent).toContain("taking longer than usual")
    expect(host.textContent).not.toContain('Generation failed')
  })

  it('Thesis: shows the real "trying a different angle" copy while genuinely retrying', async () => {
    h.useGenAutoRetry.mockReturnValue(stuck(true))
    const { Thesis } = await import('@/components/build/artifacts/company-artifacts')
    render(React.createElement(Thesis))
    expect(host.textContent).toContain('trying a different angle')
  })

  it('Thesis: renders real generated data with real tags, once a real draft lands', async () => {
    h.useGenAutoRetry.mockReturnValue(ready({ meta: 'Real meta', problem: 'Real problem', problemTag: 'Validated', who: 'Real who', whoTag: 'Assumed', wedge: 'Real wedge', whyNow: 'Real why now' }))
    const { Thesis } = await import('@/components/build/artifacts/company-artifacts')
    render(React.createElement(Thesis))

    expect(host.textContent).toContain('Real meta')
    expect(host.textContent).toContain('Real problem')
    expect(host.textContent).toContain('Validated')
    expect(host.textContent).toContain('Real wedge')
  })

  it('Thesis: shows the real inline GenError note ALONGSIDE existing good data on a follow-up regenerate failure (never replaces it)', async () => {
    h.useGenAutoRetry.mockReturnValue(ready({ meta: 'Still here', problem: 'p', who: 'w', wedge: 'wdg', whyNow: 'wn' }, 'edit_failed'))
    const { Thesis } = await import('@/components/build/artifacts/company-artifacts')
    render(React.createElement(Thesis))

    expect(host.textContent).toContain('Generation failed (edit_failed)')
    expect(host.textContent).toContain('Still here')
  })

  it('BusinessModel: renders real pricing tiers and real unit-economics bullets', async () => {
    h.useGenAutoRetry.mockReturnValue(ready({ tiers: [{ plan: 'Pro', price: '$49/mo', for: 'Growing teams' }], economics: ['CAC: $120', 'LTV: $900'] }))
    const { BusinessModel } = await import('@/components/build/artifacts/company-artifacts')
    render(React.createElement(BusinessModel))

    expect(host.querySelector('table')).not.toBeNull()
    expect(host.textContent).toContain('Pro')
    expect(host.textContent).toContain('$49/mo')
    expect(host.textContent).toContain('CAC: $120')
  })

  it('Positioning: renders the real positioning statement and real "unlike" differentiators', async () => {
    h.useGenAutoRetry.mockReturnValue(ready({ statement: 'The only CRM built for plumbers.', unlike: ['Generic CRMs that ignore trade workflows'] }))
    const { Positioning } = await import('@/components/build/artifacts/company-artifacts')
    render(React.createElement(Positioning))

    expect(host.querySelector('blockquote')?.textContent).toBe('The only CRM built for plumbers.')
    expect(host.textContent).toContain('Generic CRMs that ignore trade workflows')
  })

  it('Landing: renders real headline/sub/features with the real static CTA buttons', async () => {
    h.useGenAutoRetry.mockReturnValue(ready({ eyebrow: 'Now in beta', headline: 'Run your shop from your phone', sub: 'Real sub copy', features: [{ h: 'Dispatch', d: 'Real feature desc' }] }))
    const { Landing } = await import('@/components/build/artifacts/company-artifacts')
    render(React.createElement(Landing))

    expect(host.textContent).toContain('Now in beta')
    expect(host.textContent).toContain('Run your shop from your phone')
    expect(host.textContent).toContain('Dispatch')
    expect(host.textContent).toContain('Get early access')
    expect(host.textContent).toContain('See a demo')
  })

  it('Landing: shows the real calm GenStuck state (the free top-of-funnel view with no fallback copy) while genuinely stuck', async () => {
    h.useGenAutoRetry.mockReturnValue(stuck())
    const { Landing } = await import('@/components/build/artifacts/company-artifacts')
    render(React.createElement(Landing))
    expect(host.textContent).toContain('taking longer than usual')
  })

  it('Plan30: renders real week-by-week plan items', async () => {
    h.useGenAutoRetry.mockReturnValue(ready({ weeks: [{ w: 'Week 1', d: 'Real week 1 plan' }] }))
    const { Plan30 } = await import('@/components/build/artifacts/company-artifacts')
    render(React.createElement(Plan30))

    expect(host.textContent).toContain('Week 1')
    expect(host.textContent).toContain('Real week 1 plan')
  })

  it('Plan30: shows the real company name line only when state.companyName is genuinely set', async () => {
    h.state = { companyName: 'Acme Plumbing Co' }
    h.useGenAutoRetry.mockReturnValue(ready({ weeks: [] }))
    const { Plan30 } = await import('@/components/build/artifacts/company-artifacts')
    render(React.createElement(Plan30))

    expect(host.querySelector('[data-testid="plan30-company-name"]')?.textContent).toContain('Acme Plumbing Co')
  })

  it('Plan30: never shows the company name line when state.companyName is genuinely empty', async () => {
    h.state = { companyName: '' }
    h.useGenAutoRetry.mockReturnValue(ready({ weeks: [] }))
    const { Plan30 } = await import('@/components/build/artifacts/company-artifacts')
    render(React.createElement(Plan30))

    expect(host.querySelector('[data-testid="plan30-company-name"]')).toBeNull()
  })

  it('Plan30: a real "See it live" click dispatches the real COMPANY_DONE action', async () => {
    h.useGenAutoRetry.mockReturnValue(ready({ weeks: [] }))
    const { Plan30 } = await import('@/components/build/artifacts/company-artifacts')
    render(React.createElement(Plan30))

    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('See it live')) as HTMLButtonElement
    await act(async () => { btn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'COMPANY_DONE' })
  })

  it('COMPANY_ARTIFACT_BODIES: the real registry maps every expected view key to a real, distinct component', async () => {
    const { COMPANY_ARTIFACT_BODIES } = await import('@/components/build/artifacts/company-artifacts')
    const expectedKeys = ['thesis', 'businessModel', 'positioning', 'landing', 'plan30']
    expect(Object.keys(COMPANY_ARTIFACT_BODIES).sort()).toEqual(expectedKeys.sort())
    expectedKeys.forEach((key) => expect(typeof COMPANY_ARTIFACT_BODIES[key]).toBe('function'))
  })
})
