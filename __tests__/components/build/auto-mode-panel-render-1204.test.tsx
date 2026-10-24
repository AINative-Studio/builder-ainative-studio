// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { AutoModePanel } from '@/components/build/AutoModePanel'
import type { AutoRun } from '@/lib/build/auto-mode'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — AutoModePanel (components/build/AutoModePanel.tsx,
 * 241 lines, reached live via components/build/screens/Live.tsx) had zero test
 * coverage. lib/build/auto-mode.ts's pure helpers (runProgress, creditCostLabel,
 * DURATION_LABELS, AUTO_DURATIONS) are already independently tested
 * (__tests__/lib/build/auto-mode.test.ts) — used here REAL, not mocked, since
 * they're pure/cheap and the panel's own data-testid markup makes asserting on
 * their real combined output straightforward. Only fetch is mocked.
 */

function jsonResponse(data: any, ok = true) {
  return { ok, json: async () => data }
}

/** Dates are relative to the real current clock (not a fixed past date) so
 *  runProgress's own real expiry comparison sees a genuinely still-active
 *  run in every test, including the ones that don't call vi.setSystemTime. */
function makeRun(overrides: Partial<AutoRun> = {}): AutoRun {
  return {
    kind: 'auto', companyId: 'co-1', companyName: 'Acme', duration: '4h',
    startedAt: new Date(Date.now() - 60 * 60000).toISOString(),
    expiresAt: new Date(Date.now() + 3 * 60 * 60000).toISOString(),
    stoppedAt: null,
    ...overrides,
  }
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function byTestId(id: string): HTMLElement {
  return host.querySelector(`[data-testid="${id}"]`) as HTMLElement
}

function baseProps(overrides: Record<string, any> = {}) {
  return { companyId: 'co-1', companyName: 'Acme', unlocked: true, onUpgrade: vi.fn(), ...overrides }
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('AutoModePanel — real load/start/stop/countdown coverage (#1204)', () => {
  it('shows the real loading state before the real GET resolves', async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any
    render(React.createElement(AutoModePanel, baseProps()))
    expect(byTestId('auto-mode-loading')).not.toBeNull()
  })

  it('fetches the real GET endpoint with the real companyId, then shows the real idle duration selector', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ configured: true, run: null })) as any
    render(React.createElement(AutoModePanel, baseProps()))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/build/auto-mode?companyId=co-1'))
    expect(byTestId('auto-mode-idle')).not.toBeNull()
    expect(byTestId('auto-mode-status').textContent).toBe('off')
  })

  it('shows the real honest disabled note (never a faked run) when the real store is unconfigured', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ configured: false, run: null })) as any
    render(React.createElement(AutoModePanel, baseProps({ companyName: 'Acme' })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('auto-mode-disabled-note').textContent).toContain('Acme')
    expect(byTestId('auto-mode-idle')).toBeNull()
  })

  it('renders all 5 real duration options, defaulting to the real 4h selection', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ configured: true, run: null })) as any
    render(React.createElement(AutoModePanel, baseProps()))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('auto-mode-duration-1h')).not.toBeNull()
    expect(byTestId('auto-mode-duration-continuous')).not.toBeNull()
    expect(byTestId('auto-mode-duration-4h').getAttribute('aria-checked')).toBe('true')
    expect(byTestId('auto-mode-duration-1h').getAttribute('aria-checked')).toBe('false')
  })

  it('a real duration click updates the real selected chip and the real cost label', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ configured: true, run: null })) as any
    render(React.createElement(AutoModePanel, baseProps()))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { byTestId('auto-mode-duration-continuous').click() })

    expect(byTestId('auto-mode-duration-continuous').getAttribute('aria-checked')).toBe('true')
    expect(byTestId('auto-mode-cost').textContent).toContain('credits/hour')
  })

  it('shows the real "(This Feature Is Included In Your Plan)" cost suffix when unlocked', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ configured: true, run: null })) as any
    render(React.createElement(AutoModePanel, baseProps({ unlocked: true })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('auto-mode-cost').textContent).toContain('Included In Your Plan')
    expect(byTestId('auto-mode-start').textContent).toBe('START AUTO MODE')
  })

  it('shows the real "Paid plan required" cost suffix + arrow CTA when locked, and clicking Start calls onUpgrade without a real POST', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ configured: true, run: null })) as any
    const onUpgrade = vi.fn()
    render(React.createElement(AutoModePanel, baseProps({ unlocked: false, onUpgrade })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('auto-mode-cost').textContent).toContain('Paid plan required')
    expect(byTestId('auto-mode-start').textContent).toBe('START AUTO MODE ↗')

    vi.clearAllMocks()
    await act(async () => { byTestId('auto-mode-start').click() })

    expect(onUpgrade).toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('a real Start click fires the real POST with action start + the real selected duration, then shows the real running card', async () => {
    const run = makeRun({ duration: '1h' })
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') return jsonResponse({ ok: true, run })
      return jsonResponse({ configured: true, run: null })
    }) as any
    render(React.createElement(AutoModePanel, baseProps()))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { byTestId('auto-mode-duration-1h').click() })
    await act(async () => { byTestId('auto-mode-start').click(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/build/auto-mode', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ companyId: 'co-1', companyName: 'Acme', track: 'company', duration: '1h', action: 'start' }),
    }))
    expect(byTestId('auto-mode-running')).not.toBeNull()
    expect(byTestId('auto-mode-notice').textContent).toContain('Auto Mode on')
  })

  it('on a real "not_paid" reason, calls onUpgrade and shows no faked run', async () => {
    const onUpgrade = vi.fn()
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') return jsonResponse({ ok: false, reason: 'not_paid' })
      return jsonResponse({ configured: true, run: null })
    }) as any
    render(React.createElement(AutoModePanel, baseProps({ onUpgrade })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { byTestId('auto-mode-start').click(); await Promise.resolve(); await Promise.resolve() })

    expect(onUpgrade).toHaveBeenCalled()
    expect(byTestId('auto-mode-idle')).not.toBeNull()
  })

  it('on a real "unverified" reason, shows a real retry notice and never redirects to upgrade (the documented #841 bug fix)', async () => {
    const onUpgrade = vi.fn()
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') return jsonResponse({ ok: false, reason: 'unverified' })
      return jsonResponse({ configured: true, run: null })
    }) as any
    render(React.createElement(AutoModePanel, baseProps({ onUpgrade })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { byTestId('auto-mode-start').click(); await Promise.resolve(); await Promise.resolve() })

    expect(onUpgrade).not.toHaveBeenCalled()
    expect(byTestId('auto-mode-notice').textContent).toContain('Could not verify your plan')
  })

  it('on a real "unavailable" reason, flips to the real disabled-note state', async () => {
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') return jsonResponse({ ok: false, reason: 'unavailable' })
      return jsonResponse({ configured: true, run: null })
    }) as any
    render(React.createElement(AutoModePanel, baseProps()))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { byTestId('auto-mode-start').click(); await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('auto-mode-disabled-note')).not.toBeNull()
  })

  it('never crashes on a genuinely rejected real start POST, shows the real retry notice', async () => {
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') throw new Error('network down')
      return jsonResponse({ configured: true, run: null })
    }) as any
    render(React.createElement(AutoModePanel, baseProps()))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { byTestId('auto-mode-start').click(); await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('auto-mode-notice').textContent).toContain('try again')
  })

  it('shows the real running state with real dispatches/time-remaining from a run loaded on mount', async () => {
    const run = makeRun({ startedAt: new Date('2026-01-15T10:00:00Z').toISOString(), expiresAt: new Date('2026-01-15T14:00:00Z').toISOString() })
    global.fetch = vi.fn(async () => jsonResponse({ configured: true, run })) as any
    vi.setSystemTime(new Date('2026-01-15T11:00:00Z'))
    render(React.createElement(AutoModePanel, baseProps()))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('auto-mode-status').textContent).toBe('running')
    expect(byTestId('auto-mode-time-remaining').textContent).toMatch(/3h left/)
    expect(byTestId('auto-mode-tasks-dispatched').textContent).toMatch(/tasks dispatched this run/)
  })

  it('a real Stop click fires the real POST with action stop, then returns to the real idle state', async () => {
    const run = makeRun()
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') return jsonResponse({ ok: true, run: null })
      return jsonResponse({ configured: true, run })
    }) as any
    render(React.createElement(AutoModePanel, baseProps()))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('auto-mode-running')).not.toBeNull()
    await act(async () => { byTestId('auto-mode-stop').click(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/build/auto-mode', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ companyId: 'co-1', companyName: 'Acme', track: 'company', action: 'stop' }),
    }))
    expect(byTestId('auto-mode-idle')).not.toBeNull()
    expect(byTestId('auto-mode-notice').textContent).toBe('Auto Mode stopped.')
  })
})
