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
 * /evidence — "Verify commit readiness" panel (#1213). The real UI
 * consumer for the previously orphaned POST /api/evidence/verify, added to
 * the existing public /evidence page (already live, linked from the public
 * nav per #1215) rather than a new page.
 */

vi.mock('@/components/shared/public-nav', () => ({ PublicNav: () => null }))
vi.mock('@/components/evidence/evidence-timeline', () => ({ EvidenceTimeline: () => null }))

const galleryMock = vi.hoisted(() => ({ onSelect: null as any }))
vi.mock('@/components/evidence/evidence-gallery', () => ({
  EvidenceGallery: (props: any) => {
    galleryMock.onSelect = props.onEvidenceSelect
    return null
  },
}))

import EvidencePage from '@/app/evidence/page'

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
  await act(async () => { root.render(React.createElement(EvidencePage)) })
}

describe('/evidence — Verify commit readiness panel (#1213)', () => {
  it('pre-fills the user id when an evidence row is selected from the gallery', async () => {
    global.fetch = vi.fn() as any
    await render()

    act(() => {
      galleryMock.onSelect({
        id: 'ev1',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        git_branch: 'feature/x',
        type: 'test-run',
        status: 'success',
        title: 't',
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
      })
    })

    const input = host.querySelector('[data-testid="evidence-verify-userid"]') as HTMLInputElement
    expect(input.value).toBe('550e8400-e29b-41d4-a716-446655440000')
    const branchInput = host.querySelector('[data-testid="evidence-verify-branch"]') as HTMLInputElement
    expect(branchInput.value).toBe('feature/x')
  })

  it('calls the real verify route and shows a passed result', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        passed: true,
        missingEvidence: [],
        failedEvidence: [],
        message: 'All required evidence present and passing',
      }),
    })) as any

    await render()

    act(() => {
      galleryMock.onSelect({
        id: 'ev1',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'test-run',
        status: 'success',
        title: 't',
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
      })
    })

    const btn = host.querySelector('[data-testid="evidence-verify-submit"]') as HTMLButtonElement
    await act(async () => { btn.click() })
    await act(async () => { await Promise.resolve() })

    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/evidence/verify')
    const sentBody = JSON.parse((global.fetch as any).mock.calls[0][1].body)
    expect(sentBody.user_id).toBe('550e8400-e29b-41d4-a716-446655440000')

    expect(host.querySelector('[data-testid="evidence-verify-result"]')?.textContent).toContain('Ready to commit')
  })

  it('shows an inline error (not a crash) when verification fails to run', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Invalid request body' }) })) as any

    await render()

    const input = host.querySelector('[data-testid="evidence-verify-userid"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, '550e8400-e29b-41d4-a716-446655440000')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const btn = host.querySelector('[data-testid="evidence-verify-submit"]') as HTMLButtonElement
    await act(async () => { btn.click() })
    await act(async () => { await Promise.resolve() })

    expect(host.querySelector('[data-testid="evidence-verify-error"]')).not.toBeNull()
  })
})
