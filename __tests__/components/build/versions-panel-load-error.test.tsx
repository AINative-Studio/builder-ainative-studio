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
 * VersionsPanel — honest load-failure state, same bug shape as the
 * WaitlistPanel/VisitorsPanel/GrowthPanel/TasksPanel fixes.
 *
 * Real bug: a non-ok response (or a thrown fetch) from /api/build/versions
 * was swallowed identically to a genuinely fresh company with zero deploy
 * history, so the panel showed "No deploy history yet" even though the real
 * answer was "couldn't check." A founder reading this had no way to tell a
 * transient registry hiccup apart from an actually-empty deploy history.
 */

import { VersionsPanel } from '@/components/build/VersionsPanel'

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function q(testid: string): HTMLElement | null {
  return host.querySelector(`[data-testid="${testid}"]`)
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('VersionsPanel — load failure vs. genuine empty deploy history', () => {
  it('shows the honest error state on a non-ok response, never "No deploy history yet"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as any))

    render(<VersionsPanel companyId="agentive" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('versions-error')).toBeTruthy()
    expect(q('versions-empty')).toBeFalsy()
  })

  it('shows the honest error state when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

    render(<VersionsPanel companyId="agentive" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('versions-error')).toBeTruthy()
    expect(q('versions-empty')).toBeFalsy()
  })

  it('still shows the genuine empty state on a real ok:true, versions:[] response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ versions: [], serviced: false }) }) as any))

    render(<VersionsPanel companyId="fresh" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('versions-empty')).toBeTruthy()
    expect(q('versions-error')).toBeFalsy()
  })

  it('renders the real version list on success, with no error state', async () => {
    const versions = [{ deploymentId: 'd1', status: 'live', message: 'Add dark mode', current: true, canRollback: false }]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ versions, serviced: true }) }) as any))

    render(<VersionsPanel companyId="agentive" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('versions-error')).toBeFalsy()
    expect(q('versions-list')).toBeTruthy()
  })
})
