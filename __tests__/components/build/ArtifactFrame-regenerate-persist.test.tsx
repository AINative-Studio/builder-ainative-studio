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
 * ArtifactFrame's Regenerate action (GR-16 #329) re-POSTs /api/build/artifact
 * for the current view. #927 threads state.appChatId through as `companyId`
 * on this call too, so a founder's redraft persists server-side exactly like
 * the first generation — otherwise a regenerated PRD would silently stop
 * being durable the moment a founder clicks "Regenerate".
 */

let mockState: any
const dispatchMock = vi.fn()
const goViewMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: mockState, views: ['prd'], goView: goViewMock, dispatch: dispatchMock }),
}))

import { ArtifactFrame } from '@/components/build/ArtifactFrame'

let host: HTMLElement
let root: Root

function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root.render(
      React.createElement(ArtifactFrame, { title: 'PRD', status: 'done', view: 'prd' }),
    )
  })
}

function baseState(overrides: Partial<any> = {}) {
  return {
    companyName: 'Acme',
    idea: 'A simple todo list app',
    track: 'app',
    generated: { prd: { title: 'Todo App PRD' } },
    appChatId: 'acme-co',
    ...overrides,
  }
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ArtifactFrame regenerate — persists via companyId (#927)', () => {
  it('includes companyId (state.appChatId) in the regenerate POST body', async () => {
    mockState = baseState()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: { title: 'Todo App PRD v2' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render()

    // "Regenerate" toggles open the feedback panel; "Regenerate →" inside it
    // actually fires runRegenerate()/the fetch.
    const toggleBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Regenerate')
    expect(toggleBtn).toBeTruthy()
    act(() => { toggleBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    const submitBtn = Array.from(host.querySelectorAll('button')).find((b) => /regenerate/i.test(b.textContent || '') && b !== toggleBtn)
    expect(submitBtn).toBeTruthy()
    await act(async () => {
      submitBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/build/artifact',
      expect.objectContaining({ method: 'POST' }),
    )
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sentBody.view).toBe('prd')
    expect(sentBody.companyId).toBe('acme-co')
  })

  it('omits companyId when no project exists yet (appChatId empty)', async () => {
    mockState = baseState({ appChatId: '' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: { title: 'Todo App PRD v2' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render()

    const toggleBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Regenerate')
    act(() => { toggleBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const submitBtn = Array.from(host.querySelectorAll('button')).find((b) => /regenerate/i.test(b.textContent || '') && b !== toggleBtn)
    await act(async () => {
      submitBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sentBody.companyId).toBeUndefined()
  })
})
