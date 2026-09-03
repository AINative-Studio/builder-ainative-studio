// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MediaPanel } from '@/components/build/MediaPanel'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #54 — real jsdom render tests for the latest-generated-image preview.
 *
 * Real bug report: a founder hit "Generate Image", the call genuinely
 * succeeded (a real asset was persisted), but NOTHING visibly appeared on
 * the dashboard — the panel only ever rendered a small text link ("View
 * latest image →" opening a new tab), no inline thumbnail. Easy to miss
 * entirely, which read as "nothing happened" even though generation worked.
 */

let host: HTMLElement
let root: Root

function render(el: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(el))
}

function unmount() {
  act(() => root.unmount())
  host.remove()
}

const IMAGE_ASSET_ROW = {
  routines: [],
  assets: [
    {
      id: 'a1',
      mediaKind: 'image',
      url: '/api/build/media/upload?id=11111111-1111-1111-1111-111111111111',
      prompt: 'a marketing image',
      createdAt: '2026-09-03T00:00:00Z',
      provider: 'multimodal',
    },
  ],
  configured: true,
  nextRuns: {},
}

describe('MediaPanel — latest generated image preview', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ routines: [], assets: [], configured: true, nextRuns: {} }) })
  })
  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  it('renders an inline <img> thumbnail for the latest generated image (not just a text link)', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => IMAGE_ASSET_ROW })
    render(<MediaPanel companyId="beacon" companyName="Beacon" />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const img = host.querySelector('[data-testid="media-asset-image"] img') as HTMLImageElement
    expect(img).toBeTruthy()
    expect(img.src).toContain('/api/build/media/upload?id=11111111-1111-1111-1111-111111111111')
  })

  it('the thumbnail links out to the real full asset URL', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => IMAGE_ASSET_ROW })
    render(<MediaPanel companyId="beacon" companyName="Beacon" />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const link = host.querySelector('[data-testid="media-asset-image"]') as HTMLAnchorElement
    expect(link.tagName).toBe('A')
    expect(link.href).toContain('/api/build/media/upload?id=11111111-1111-1111-1111-111111111111')
    expect(link.target).toBe('_blank')
  })

  it('shows no thumbnail/link when there is no generated image yet (honest empty state)', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ routines: [], assets: [], configured: true, nextRuns: {} }),
    })
    render(<MediaPanel companyId="beacon" companyName="Beacon" />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(host.querySelector('[data-testid="media-asset-image"]')).toBeFalsy()
    expect(host.textContent).toContain('No media yet')
  })

  it('video keeps the text link (no <video> preview) even when an asset exists', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        routines: [],
        assets: [{ id: 'v1', mediaKind: 'video', url: '/api/build/media/upload?id=22222222-2222-2222-2222-222222222222', prompt: 'p', createdAt: '2026-09-03T00:00:00Z' }],
        configured: true,
        nextRuns: {},
      }),
    })
    render(<MediaPanel companyId="beacon" companyName="Beacon" />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const link = host.querySelector('[data-testid="media-asset-video"]') as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.querySelector('img')).toBeFalsy()
    expect(link.textContent).toContain('View latest video')
  })

  it('an uploaded photo is never shown as the "latest generated" thumbnail (uploads vs Cody-generated stay distinct)', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        routines: [],
        assets: [{ id: 'u1', mediaKind: 'image', url: '/x/upload.png', prompt: '', createdAt: '2026-09-03T00:00:00Z', provider: 'upload' }],
        configured: true,
        nextRuns: {},
      }),
    })
    render(<MediaPanel companyId="beacon" companyName="Beacon" />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(host.querySelector('[data-testid="media-asset-image"]')).toBeFalsy()
  })

  it('generating a new image reloads and the thumbnail reflects the fresh asset', async () => {
    const fetchMock = vi.fn()
      // initial load — no asset yet
      .mockResolvedValueOnce({ ok: true, json: async () => ({ routines: [], assets: [], configured: true, nextRuns: {} }) })
      // POST generate
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'generated', asset: IMAGE_ASSET_ROW.assets[0] }) })
      // reload after generate
      .mockResolvedValueOnce({ ok: true, json: async () => IMAGE_ASSET_ROW })
    global.fetch = fetchMock as any
    render(<MediaPanel companyId="beacon" companyName="Beacon" />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(host.querySelector('[data-testid="media-asset-image"]')).toBeFalsy()

    const startBtn = host.querySelector('[data-testid="media-start-image"]') as HTMLButtonElement
    // START AUTO schedules then immediately generates when configured (see MediaPanel's start()).
    // Simulate the same flow by directly hitting generate via the Update/Start button path is
    // covered elsewhere; here we assert the render reflects a reload with an asset present.
    await act(async () => {
      startBtn.click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    const img = host.querySelector('[data-testid="media-asset-image"] img')
    expect(img).toBeTruthy()
  })
})
