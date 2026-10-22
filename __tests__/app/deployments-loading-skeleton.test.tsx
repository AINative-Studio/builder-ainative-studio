// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

// app/deployments/page.tsx defines module-scope JSX (the platformIcons map),
// which evaluates at import time — before a beforeAll hook would run — so
// the React global has to be set synchronously, ahead of the dynamic import
// below, rather than in beforeAll.
;(globalThis as any).React = React
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

/**
 * /deployments (#1190) — this page rendered a bare spinner while fetching,
 * with no shape resembling the deployment table underneath. Now it shows a
 * skeleton matching the real table's rows/columns, same as the Preview.tsx
 * generation-skeleton pattern used elsewhere.
 */

vi.mock('@/components/shared/app-header', () => ({ AppHeader: () => null }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const { default: DeploymentsPage } = await import('@/app/deployments/page')

let host: HTMLElement
let root: Root

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  vi.useRealTimers()
})

async function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(React.createElement(DeploymentsPage)) })
}

async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }
}

describe('/deployments — skeleton loading state (#1190)', () => {
  it('shows a table-shaped skeleton while /api/deployments is in flight', async () => {
    // Never-resolving fetch: simulates a real in-flight request so we can
    // assert on the loading render without needing the request to settle.
    global.fetch = vi.fn(() => new Promise(() => {})) as any

    await render()

    const skeleton = host.querySelector('[data-testid="deployments-loading"]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    // The spinner-only fallback must be gone.
    expect(host.textContent).not.toContain('Deployment History')
  })

  it('replaces the skeleton with the real table once deployments load', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        deployments: [
          {
            id: 'd1',
            generationId: 'g1',
            platform: 'railway',
            url: 'https://example.ainative.studio',
            status: 'ready',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    })) as any

    await render()
    await flush()

    expect(host.querySelector('[data-testid="deployments-loading"]')).toBeNull()
    expect(host.textContent).toContain('Deployment History')
    expect(host.textContent).toContain('example.ainative.studio')
  })
})
