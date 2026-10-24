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
 * AutoModePanel — honest load-failure state, same bug shape as the
 * WaitlistPanel/VisitorsPanel/GrowthPanel/TasksPanel/VersionsPanel fixes,
 * but with a sharper consequence: `startAutoRun` has no idempotency guard,
 * so showing the IDLE "START AUTO MODE" button on a transient status-check
 * failure (instead of an honest error) risks firing a real second swarm
 * dispatch on top of an already-active run.
 */

import { AutoModePanel } from '@/components/build/AutoModePanel'

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

const baseProps = {
  companyId: 'agentive', companyName: 'Agentive', unlocked: true, onUpgrade: () => {},
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AutoModePanel — load failure vs. genuine idle state', () => {
  it('shows the honest error state on a non-ok response, never the START button', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as any))

    render(<AutoModePanel {...baseProps} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('auto-mode-error')).toBeTruthy()
    expect(q('auto-mode-idle')).toBeFalsy()
    expect(q('auto-mode-start')).toBeFalsy()
  })

  it('shows the honest error state when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

    render(<AutoModePanel {...baseProps} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('auto-mode-error')).toBeTruthy()
    expect(q('auto-mode-idle')).toBeFalsy()
  })

  it('refuses to start while the status check has failed, never dispatching blind', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('should never POST while status is unknown')
      return { ok: false, status: 503, json: async () => ({}) } as any
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AutoModePanel {...baseProps} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(fetchMock).toHaveBeenCalledTimes(1) // only the GET, never a POST
  })

  it('still shows the genuine idle/start state on a real ok:true, run:null response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ configured: true, run: null }) }) as any))

    render(<AutoModePanel {...baseProps} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('auto-mode-idle')).toBeTruthy()
    expect(q('auto-mode-error')).toBeFalsy()
  })
})
