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
 * components/build/VersionsPanel.tsx (#1190) — the version history list
 * rendered a plain "loading versions…" text string while /api/build/versions
 * was in flight, with no shape resembling the m-task-card list underneath.
 * Now it shows shimmer placeholder cards matching that real list.
 */

import { VersionsPanel } from '@/components/build/VersionsPanel'

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
  await act(async () => {
    root.render(React.createElement(VersionsPanel, { companyId: 'co1' }))
  })
}

async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }
}

describe('VersionsPanel — skeleton loading state (#1190)', () => {
  it('shows card-shaped skeletons while /api/build/versions is in flight', async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any

    await render()

    const skeleton = host.querySelector('[data-testid="versions-loading"]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.querySelectorAll('.m-shimmer').length).toBeGreaterThan(0)
    expect(host.textContent).not.toContain('loading versions')
  })

  it('replaces the skeleton with the real version list once versions load', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        serviced: true,
        versions: [
          {
            deploymentId: 'dep1',
            status: 'live',
            message: 'Ship the pricing page',
            commitSha: 'abc1234',
            createdAt: new Date().toISOString(),
            current: true,
            canRollback: false,
          },
        ],
      }),
    })) as any

    await render()
    await flush()

    expect(host.querySelector('[data-testid="versions-loading"]')).toBeNull()
    expect(host.querySelector('[data-testid="versions-list"]')).not.toBeNull()
    expect(host.textContent).toContain('Ship the pricing page')
  })
})
