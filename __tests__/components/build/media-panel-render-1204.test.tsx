// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MediaPanel } from '@/components/build/MediaPanel'
import { UPLOAD_PROVIDER } from '@/lib/build/media-upload'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — MediaPanel (components/build/MediaPanel.tsx,
 * 455 lines, reached live via components/build/screens/Live.tsx) had zero
 * test coverage. Uses the real isUploadedAsset()/UPLOAD_PROVIDER from
 * lib/build/media-upload.ts rather than guessing the provider sentinel.
 */

function jsonResponse(data: any, ok = true) {
  return Promise.resolve({ ok, json: async () => data } as Response)
}

function baseMediaData(overrides: Partial<{ routines: any[]; assets: any[]; configured: boolean; nextRuns: Record<string, string | null> }> = {}) {
  return { routines: [], assets: [], configured: true, nextRuns: {}, ...overrides }
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('MediaPanel — real schedule/generate/upload/library coverage (#1204)', () => {
  it('shows the real loading state, then both real kind cards OFF by default with no routine', async () => {
    global.fetch = vi.fn(() => jsonResponse(baseMediaData())) as any
    render(React.createElement(MediaPanel, { companyId: 'co-1' }))

    expect(host.querySelector('[data-testid="media-loading"]')).not.toBeNull()
    await flush()

    expect(host.querySelector('[data-testid="media-status-image"]')?.textContent).toBe('OFF')
    expect(host.querySelector('[data-testid="media-status-video"]')?.textContent).toBe('OFF')
    expect(host.querySelector('[data-testid="media-next-image"]')?.textContent).toBe('Not scheduled')
    expect(host.querySelector('[data-testid="media-last-image"]')?.textContent).toBe('No media yet')
  })

  it('shows the real "not switched on" note only when genuinely unconfigured', async () => {
    global.fetch = vi.fn(() => jsonResponse(baseMediaData({ configured: false }))) as any
    render(React.createElement(MediaPanel, { companyId: 'co-1', companyName: 'Acme' }))
    await flush()

    expect(host.querySelector('[data-testid="media-disabled-note"]')).not.toBeNull()
    expect(host.textContent).toContain('Acme')
  })

  it('reflects a real persisted routine\'s frequency and AUTO ON status into the selector', async () => {
    global.fetch = vi.fn(() => jsonResponse(baseMediaData({
      routines: [{ id: 'r1', mediaKind: 'image', frequency: 'daily', enabled: true, createdAt: new Date().toISOString() }],
    }))) as any
    render(React.createElement(MediaPanel, { companyId: 'co-1' }))
    await flush()

    expect(host.querySelector('[data-testid="media-status-image"]')?.textContent).toBe('AUTO ON')
    expect(host.querySelector('[data-testid="media-freq-image-daily"]')?.getAttribute('aria-checked')).toBe('true')
    expect(host.querySelector('[data-testid="media-start-image"]')?.textContent).toContain('Update Auto Image')
  })

  it('clicking a real frequency option updates the real selected chip', async () => {
    global.fetch = vi.fn(() => jsonResponse(baseMediaData())) as any
    render(React.createElement(MediaPanel, { companyId: 'co-1' }))
    await flush()

    expect(host.querySelector('[data-testid="media-freq-image-weekly"]')?.getAttribute('aria-checked')).toBe('true')

    const monthlyBtn = host.querySelector('[data-testid="media-freq-image-monthly"]') as HTMLButtonElement
    await act(async () => { monthlyBtn.click() })

    expect(host.querySelector('[data-testid="media-freq-image-monthly"]')?.getAttribute('aria-checked')).toBe('true')
    expect(host.querySelector('[data-testid="media-freq-image-weekly"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('Start Auto schedules with the real selected frequency, then immediately generates when configured', async () => {
    let scheduled: any = null
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url)
      if (u === '/api/build/media' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string)
        if (body.action === 'schedule') {
          scheduled = body
          return jsonResponse({ configured: true })
        }
        if (body.action === 'generate') {
          return jsonResponse({ status: 'generated' })
        }
      }
      return jsonResponse(baseMediaData({
        routines: scheduled ? [{ id: 'r1', mediaKind: 'image', frequency: scheduled.frequency, enabled: true, createdAt: new Date().toISOString() }] : [],
      }))
    })
    global.fetch = fetchMock as any

    render(React.createElement(MediaPanel, { companyId: 'co-1', companyName: 'Acme', brandTagline: 'Great coffee', brandColor: '#abc', idea: 'coffee app' }))
    await flush()

    const monthlyBtn = host.querySelector('[data-testid="media-freq-image-monthly"]') as HTMLButtonElement
    await act(async () => { monthlyBtn.click() })

    const startBtn = host.querySelector('[data-testid="media-start-image"]') as HTMLButtonElement
    await act(async () => { startBtn.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(scheduled).toEqual({ companyId: 'co-1', mediaKind: 'image', frequency: 'monthly', action: 'schedule' })
    expect(fetchMock).toHaveBeenCalledWith('/api/build/media', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ companyId: 'co-1', mediaKind: 'image', action: 'generate', brand: { companyName: 'Acme', tagline: 'Great coffee', color: '#abc', idea: 'coffee app' } }),
    }))
  })

  it('Start Auto when unconfigured shows the real "switches on once enabled" notice and never calls generate', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === '/api/build/media' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string)
        if (body.action === 'schedule') return jsonResponse({ configured: false })
      }
      return jsonResponse(baseMediaData({ configured: false }))
    })
    global.fetch = fetchMock as any
    render(React.createElement(MediaPanel, { companyId: 'co-1' }))
    await flush()

    const startBtn = host.querySelector('[data-testid="media-start-image"]') as HTMLButtonElement
    await act(async () => { startBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="media-notice-image"]')?.textContent).toContain('switches on once')
    expect(fetchMock).not.toHaveBeenCalledWith('/api/build/media', expect.objectContaining({
      body: expect.stringContaining('"action":"generate"'),
    }))
  })

  it('a real "disabled" generate response shows the real disabled-generation notice', async () => {
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === '/api/build/media' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string)
        if (body.action === 'schedule') return jsonResponse({ configured: true })
        if (body.action === 'generate') return jsonResponse({ status: 'disabled' })
      }
      return jsonResponse(baseMediaData())
    }) as any
    render(React.createElement(MediaPanel, { companyId: 'co-1' }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="media-start-image"]') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="media-notice-image"]')?.textContent).toContain('isn’t switched on yet')
  })

  it('maps the real per-reason generation failure messages honestly (poll_timeout vs core_error vs unknown)', async () => {
    for (const [reason, expected] of [
      ['poll_timeout', 'taking longer than expected'],
      ['core_error', 'media generation service is unavailable'],
      ['something_unrecognized', 'try again shortly'],
    ] as const) {
      global.fetch = vi.fn((url: string, init?: RequestInit) => {
        if (String(url) === '/api/build/media' && init?.method === 'POST') {
          const body = JSON.parse(init.body as string)
          if (body.action === 'schedule') return jsonResponse({ configured: true })
          if (body.action === 'generate') return jsonResponse({ status: 'error', reason })
        }
        return jsonResponse(baseMediaData())
      }) as any
      render(React.createElement(MediaPanel, { companyId: 'co-1' }))
      await flush()

      await act(async () => { (host.querySelector('[data-testid="media-start-image"]') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

      expect(host.querySelector('[data-testid="media-notice-image"]')?.textContent?.toLowerCase()).toContain(expected.toLowerCase())

      act(() => { root.unmount() })
      host.remove()
    }
  })

  it('shows the real video-only wait hint while video is genuinely generating, never for image', async () => {
    let resolveGenerate: (v: any) => void = () => {}
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === '/api/build/media' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string)
        if (body.action === 'schedule') return jsonResponse({ configured: true })
        if (body.action === 'generate') return new Promise((resolve) => { resolveGenerate = resolve })
      }
      return jsonResponse(baseMediaData())
    }) as any
    render(React.createElement(MediaPanel, { companyId: 'co-1' }))
    await flush()

    const startVideoBtn = host.querySelector('[data-testid="media-start-video"]') as HTMLButtonElement
    await act(async () => { startVideoBtn.click(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="media-video-wait-hint"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="media-start-video"]')?.getAttribute('aria-busy')).toBe('true')
    expect(host.querySelector('[data-testid="media-start-image"]')?.getAttribute('aria-busy')).toBe('false')

    await act(async () => { resolveGenerate(await jsonResponse({ status: 'generated' })); await Promise.resolve(); await Promise.resolve() })
  })

  it('renders the real latest image asset as an inline thumbnail, video as a text link', async () => {
    const now = new Date().toISOString()
    global.fetch = vi.fn(() => jsonResponse(baseMediaData({
      assets: [
        { id: 'a1', mediaKind: 'image', url: 'https://cdn.example/a1.png', prompt: 'p', createdAt: now },
        { id: 'a2', mediaKind: 'video', url: 'https://cdn.example/a2.mp4', prompt: 'p', createdAt: now },
      ],
    }))) as any
    render(React.createElement(MediaPanel, { companyId: 'co-1' }))
    await flush()

    const imgLink = host.querySelector('[data-testid="media-asset-image"]') as HTMLAnchorElement
    expect(imgLink.querySelector('img')).not.toBeNull()
    expect(imgLink.href).toContain('a1.png')

    const videoLink = host.querySelector('[data-testid="media-asset-video"]') as HTMLAnchorElement
    expect(videoLink.querySelector('img')).toBeNull()
    expect(videoLink.textContent).toContain('View latest video')
  })

  it('never counts a real uploaded asset as the "latest" auto-generated asset for its kind', async () => {
    const now = new Date().toISOString()
    global.fetch = vi.fn(() => jsonResponse(baseMediaData({
      assets: [{ id: 'up1', mediaKind: 'image', url: 'https://cdn.example/upload.png', prompt: '', createdAt: now, provider: UPLOAD_PROVIDER }],
    }))) as any
    render(React.createElement(MediaPanel, { companyId: 'co-1' }))
    await flush()

    expect(host.querySelector('[data-testid="media-asset-image"]')).toBeNull()
    expect(host.querySelector('[data-testid="media-last-image"]')?.textContent).toBe('No media yet')
  })

  it('uploading a real file validates client-side, POSTs real FormData, and reloads the library', async () => {
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' })
    let uploaded = false
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url)
      if (u === '/api/build/media/upload' && init?.method === 'POST') {
        uploaded = true
        expect(init.body).toBeInstanceOf(FormData)
        return jsonResponse({ url: 'https://cdn.example/photo.png' })
      }
      return jsonResponse(baseMediaData({
        assets: uploaded ? [{ id: 'up1', mediaKind: 'image', url: 'https://cdn.example/photo.png', prompt: '', createdAt: new Date().toISOString(), provider: UPLOAD_PROVIDER }] : [],
      }))
    }) as any
    render(React.createElement(MediaPanel, { companyId: 'co-1' }))
    await flush()

    const input = host.querySelector('[data-testid="media-upload-input"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/build/media/upload', expect.objectContaining({ method: 'POST' }))
    expect(host.querySelector('[data-testid="media-upload-notice"]')?.textContent).toContain('in the library below')
    expect(host.querySelector('[data-testid="media-library-item"]')?.getAttribute('data-media-source')).toBe('upload')
  })

  it('rejects a real oversized file client-side without ever calling the upload route', async () => {
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' })
    const fetchMock = vi.fn(() => jsonResponse(baseMediaData()))
    global.fetch = fetchMock as any
    render(React.createElement(MediaPanel, { companyId: 'co-1' }))
    await flush()

    const input = host.querySelector('[data-testid="media-upload-input"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [big], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })

    expect(host.querySelector('[data-testid="media-upload-notice"]')).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/build/media/upload', expect.anything())
  })

  it('renders the real library, distinguishing "yours" (uploaded) from "◇ Cody" (generated) per real provider', async () => {
    const now = new Date().toISOString()
    global.fetch = vi.fn(() => jsonResponse(baseMediaData({
      assets: [
        { id: 'gen1', mediaKind: 'image', url: 'https://cdn.example/g.png', prompt: 'p', createdAt: now },
        { id: 'up1', mediaKind: 'image', url: 'https://cdn.example/u.png', prompt: '', createdAt: now, provider: UPLOAD_PROVIDER },
      ],
    }))) as any
    render(React.createElement(MediaPanel, { companyId: 'co-1' }))
    await flush()

    const items = Array.from(host.querySelectorAll('[data-testid="media-library-item"]'))
    expect(items).toHaveLength(2)
    expect(items.find((i) => i.getAttribute('data-media-source') === 'generated')?.textContent).toContain('◇ Cody')
    expect(items.find((i) => i.getAttribute('data-media-source') === 'upload')?.textContent).toContain('yours')
  })

  it('never shows the library card when there are genuinely zero assets', async () => {
    global.fetch = vi.fn(() => jsonResponse(baseMediaData())) as any
    render(React.createElement(MediaPanel, { companyId: 'co-1' }))
    await flush()

    expect(host.querySelector('[data-testid="media-library"]')).toBeNull()
  })
})
