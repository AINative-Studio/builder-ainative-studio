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
 * DocumentsPanel — honest load-failure state, same bug shape as the
 * WaitlistPanel/VisitorsPanel/GrowthPanel/TasksPanel fixes.
 *
 * Real bug: a non-ok response (or a thrown fetch) from /api/build/documents
 * was swallowed identically to a genuinely empty library, so the panel
 * showed "No documents yet" (with a CTA to generate the starter set) even
 * though the real answer was "couldn't check" — risking a founder
 * re-generating starter docs they already have.
 */

import { DocumentsPanel } from '@/components/build/DocumentsPanel'

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

describe('DocumentsPanel — load failure vs. genuine empty library', () => {
  it('shows the honest error state on a non-ok response, never "No documents yet"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) }) as any))

    render(<DocumentsPanel companyId="agentive" idea="an idea" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('documents-error')).toBeTruthy()
    expect(q('documents-empty')).toBeFalsy()
  })

  it('shows the honest error state when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

    render(<DocumentsPanel companyId="agentive" idea="an idea" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('documents-error')).toBeTruthy()
    expect(q('documents-empty')).toBeFalsy()
  })

  it('never shows the "generate starter docs" CTA on a load failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as any))

    render(<DocumentsPanel companyId="agentive" idea="an idea" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('documents-generate-cta')).toBeFalsy()
  })

  it('still shows the genuine empty library on a real ok:true, documents:[] response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ documents: [], counts: { all: 0, document: 0, report: 0 } }) }) as any))

    render(<DocumentsPanel companyId="fresh" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('documents-empty')).toBeTruthy()
    expect(q('documents-error')).toBeFalsy()
  })

  it('clears a prior error once a retry (company change) succeeds', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('companyId=broken')) {
        return { ok: false, status: 503, json: async () => ({}) } as any
      }
      return { ok: true, json: async () => ({ documents: [], counts: { all: 0, document: 0, report: 0 } }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DocumentsPanel companyId="broken" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(q('documents-error')).toBeTruthy()

    await act(async () => { root.render(<DocumentsPanel companyId="fine" />) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('documents-error')).toBeFalsy()
    expect(q('documents-empty')).toBeTruthy()
  })
})
