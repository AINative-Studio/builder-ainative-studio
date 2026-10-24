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
 * TasksPanel — honest load-failure state, same bug shape as the
 * WaitlistPanel/VisitorsPanel/GrowthPanel fixes.
 *
 * Real bug: a non-ok response (or a thrown fetch) from /api/build/tasks was
 * swallowed identically to a genuinely empty backlog, so the panel showed
 * "No tasks yet" even though the real answer was "couldn't check." This is
 * the exact dashboard-integrity gap priority 2 cares about, and it sits on
 * the Tasks & Backlog panel itself.
 */

import { TasksPanel } from '@/components/build/TasksPanel'

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

describe('TasksPanel — load failure vs. genuine empty backlog', () => {
  it('shows the honest error state on a non-ok response, never "No tasks yet"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) }) as any))

    render(<TasksPanel companyId="agentive" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('tasks-error')).toBeTruthy()
    expect(q('tasks-empty')).toBeFalsy()
  })

  it('shows the honest error state when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

    render(<TasksPanel companyId="agentive" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('tasks-error')).toBeTruthy()
    expect(q('tasks-empty')).toBeFalsy()
  })

  it('still shows the genuine empty backlog on a real ok:true, tasks:[] response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ tasks: [], counts: {} }) }) as any))

    render(<TasksPanel companyId="fresh" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('tasks-empty')).toBeTruthy()
    expect(q('tasks-error')).toBeFalsy()
  })

  it('clears a prior error once a retry (company change) succeeds', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('companyId=broken')) {
        return { ok: false, status: 503, json: async () => ({}) } as any
      }
      return { ok: true, json: async () => ({ tasks: [], counts: {} }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TasksPanel companyId="broken" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(q('tasks-error')).toBeTruthy()

    await act(async () => { root.render(<TasksPanel companyId="fine" />) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('tasks-error')).toBeFalsy()
    expect(q('tasks-empty')).toBeTruthy()
  })
})
