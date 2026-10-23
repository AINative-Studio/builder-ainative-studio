// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { SWRConfig } from 'swr'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * /admin/agent-metrics (#1213) — the real UI consumer for the previously
 * orphaned GET /api/agent/metrics + GET /api/agent/export (builder#57).
 */

vi.mock('@/components/shared/app-header', () => ({ AppHeader: () => null }))

import AgentMetricsPage from '@/app/admin/agent-metrics/page'

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
  // A fresh SWRConfig provider per render gives each test its own cache —
  // without it, SWR's default global cache leaks the first test's resolved
  // data into every later test that happens to share the same key.
  await act(async () => {
    root.render(
      React.createElement(
        SWRConfig,
        { value: { provider: () => new Map() } },
        React.createElement(AgentMetricsPage),
      ),
    )
  })
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }
}

describe('Admin Agent Metrics page (#1213)', () => {
  it('renders real metrics once /api/agent/metrics resolves', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        totalRuns: 42,
        buildPassRate: 0.9,
        avgTurns: 3.5,
        avgDurationMs: 4200,
        fallbackRate: 0.1,
        fallbackSuccessRate: 0.8,
        costPerGeneration: 0.0123,
        days: 7,
        comparisonVsFastPath: { agentSuccessRate: 0.9, fastPathSuccessRate: 0.7, improvement: '+20%' },
      }),
    })) as any

    await render()

    expect(host.querySelector('[data-testid="metric-total-runs"]')?.textContent).toBe('42')
    expect(host.querySelector('[data-testid="metric-pass-rate"]')?.textContent).toBe('90%')
    expect(host.querySelector('[data-testid="metric-improvement"]')?.textContent).toBe('+20%')
    expect(host.querySelector('[data-testid="agent-metrics-error"]')).toBeNull()
  })

  it('shows an error state (not a crash) when the admin gate rejects the caller', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Admin access required' }) })) as any

    await render()

    expect(host.querySelector('[data-testid="agent-metrics-error"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="agent-metrics-content"]')).toBeNull()
  })

  it('points the export button at /api/agent/export with the current window', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        totalRuns: 1, buildPassRate: 1, avgTurns: 1, avgDurationMs: 100, fallbackRate: 0,
        fallbackSuccessRate: 0, costPerGeneration: 0.01, days: 7,
        comparisonVsFastPath: { agentSuccessRate: 1, fastPathSuccessRate: 1, improvement: '+0%' },
      }),
    })) as any

    await render()

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const btn = host.querySelector('[data-testid="agent-metrics-export"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    act(() => { btn.click() })
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('/api/agent/export?days=7&format=jsonl'), '_blank')
    openSpy.mockRestore()
  })
})
