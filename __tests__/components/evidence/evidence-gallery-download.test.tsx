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
 * components/evidence/evidence-gallery.tsx — Download button (#1213). It
 * existed on every card with NO onClick handler at all. Wires it through
 * the real GET /api/evidence/[id]/artifacts (list) + GET /api/artifacts/
 * [id] (download), both previously orphaned.
 */

import { EvidenceGallery } from '@/components/evidence/evidence-gallery'

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

const sampleEvidence = {
  id: 'ev-1',
  user_id: 'u1',
  type: 'test-run',
  status: 'success',
  title: 'Test run #1',
  metadata: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

async function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(React.createElement(EvidenceGallery, {})) })
  for (let i = 0; i < 3; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }
}

describe('EvidenceGallery — Download button (#1213)', () => {
  it('lists real artifacts and opens each one for download on click', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const fetchMock = fetchRouter({
      '/api/evidence/ev-1/artifacts': () => ({ ok: true, json: async () => ({ artifacts: [{ id: 'a1' }, { id: 'a2' }] }) }),
      '/api/evidence?': () => ({ ok: true, json: async () => ({ evidence: [sampleEvidence], pagination: { total: 1, limit: 20, offset: 0, hasMore: false } }) }),
    })
    global.fetch = fetchMock as any

    await render()

    const btn = host.querySelector('[data-testid="evidence-download-ev-1"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    await act(async () => { btn.click() })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(openSpy).toHaveBeenCalledWith('/api/artifacts/a1', '_blank')
    expect(openSpy).toHaveBeenCalledWith('/api/artifacts/a2', '_blank')
    openSpy.mockRestore()
  })

  it('does not attempt a download when there are no artifacts recorded yet', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const fetchMock = fetchRouter({
      '/api/evidence/ev-1/artifacts': () => ({ ok: true, json: async () => ({ artifacts: [] }) }),
      '/api/evidence?': () => ({ ok: true, json: async () => ({ evidence: [sampleEvidence], pagination: { total: 1, limit: 20, offset: 0, hasMore: false } }) }),
    })
    global.fetch = fetchMock as any

    await render()

    const btn = host.querySelector('[data-testid="evidence-download-ev-1"]') as HTMLButtonElement
    await act(async () => { btn.click() })
    await act(async () => { await Promise.resolve() })

    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })
})
