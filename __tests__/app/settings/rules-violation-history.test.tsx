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
 * /settings/rules — Violation History card (#1213). The real UI consumer
 * for the previously orphaned GET /api/rules/stats + GET /api/rules/
 * violations, added to the existing Rule Enforcement settings page (which
 * already has a Validation Playground that is this data's only real
 * writer, scoped to projectId 'playground').
 */

vi.mock('@/components/shared/app-header', () => ({ AppHeader: () => null }))

import RulesSettingsPage from '@/app/settings/rules/page'

let host: HTMLElement
let root: Root

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

function fetchRouter(handlers: Record<string, () => any>) {
  return vi.fn(async (url: string) => {
    for (const [key, handler] of Object.entries(handlers)) {
      if (String(url).includes(key)) return handler()
    }
    return { ok: true, json: async () => ({}) }
  })
}

async function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(React.createElement(RulesSettingsPage)) })
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }
}

describe('Settings Rules page — Violation History (#1213)', () => {
  it('renders real stats and violations once both routes resolve', async () => {
    global.fetch = fetchRouter({
      '/api/rules/stats': () => ({
        ok: true,
        json: async () => ({
          success: true,
          stats: {
            reports: { total: 4, passed: 3, failed: 1, passRate: 75 },
            topViolatedRules: [{ ruleId: 'no-ai-attribution', count: 2 }],
          },
        }),
      }),
      '/api/rules/violations': () => ({
        ok: true,
        json: async () => ({
          success: true,
          count: 1,
          violations: [
            { id: 'v1', rule_id: 'no-ai-attribution', violation_message: 'Found AI attribution', fixed: false, created_at: '2026-10-20T00:00:00Z' },
          ],
        }),
      }),
      '/api/rules': () => ({ ok: true, json: async () => ({ rules: [] }) }),
    }) as any

    await render()

    expect(host.querySelector('[data-testid="rules-stats-summary"]')?.textContent).toContain('4')
    expect(host.querySelector('[data-testid="rules-stats-summary"]')?.textContent).toContain('75%')
    expect(host.querySelector('[data-testid="rules-violations-table"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="rules-violations-empty"]')).toBeNull()
    expect(host.textContent).toContain('Found AI attribution')
  })

  it('shows the empty state (not a crash) when there is no violation history yet', async () => {
    global.fetch = fetchRouter({
      '/api/rules/stats': () => ({
        ok: true,
        json: async () => ({ success: true, stats: { reports: { total: 0, passed: 0, failed: 0, passRate: 0 }, topViolatedRules: [] } }),
      }),
      '/api/rules/violations': () => ({ ok: true, json: async () => ({ success: true, count: 0, violations: [] }) }),
      '/api/rules': () => ({ ok: true, json: async () => ({ rules: [] }) }),
    }) as any

    await render()

    expect(host.querySelector('[data-testid="rules-violations-empty"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="rules-violations-table"]')).toBeNull()
  })
})
