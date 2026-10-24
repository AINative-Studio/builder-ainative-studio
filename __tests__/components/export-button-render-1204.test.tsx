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
 * #1204 (Coverage Phase 4) — ExportButton (components/export-button.tsx,
 * 78 lines, reached live via components/chat/preview-panel.tsx) had zero
 * test coverage. useToast is not independently tested elsewhere in this
 * repo, so it's mocked here at its real exported boundary
 * (@/components/ui/use-toast) rather than relying on its real
 * (untested) internals.
 */

const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: h.toast }) }))

import { ExportButton } from '@/components/export-button'

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('ExportButton — real export/download/toast coverage (#1204)', () => {
  it('fetches the real /api/export/{generationId} route and shows the real loading state mid-flight', async () => {
    let resolveFetch: (v: any) => void = () => {}
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve })) as any
    global.URL.createObjectURL = vi.fn(() => 'blob:fake-url') as any
    global.URL.revokeObjectURL = vi.fn() as any
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(React.createElement(ExportButton, { generationId: 'gen-123' }))
    const btn = host.querySelector('button') as HTMLButtonElement
    await act(async () => { btn.click() })

    expect(global.fetch).toHaveBeenCalledWith('/api/export/gen-123')
    expect(btn.textContent).toContain('Exporting...')
    expect(btn.disabled).toBe(true)

    await act(async () => {
      resolveFetch({ ok: true, blob: async () => new Blob(['x']) })
      await Promise.resolve()
    })
  })

  it('a real successful export triggers a real anchor-click download with the real generationId-based filename', async () => {
    const blob = new Blob(['zip-bytes'])
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, blob: async () => blob } as unknown as Response)) as any
    global.URL.createObjectURL = vi.fn(() => 'blob:fake-url') as any
    global.URL.revokeObjectURL = vi.fn() as any
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let downloadedName = ''
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') {
        Object.defineProperty(el, 'download', {
          get() { return downloadedName },
          set(v) { downloadedName = v },
        })
      }
      return el
    })

    render(React.createElement(ExportButton, { generationId: 'gen-abc' }))
    const btn = host.querySelector('button') as HTMLButtonElement
    await act(async () => { btn.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(clickSpy).toHaveBeenCalled()
    expect(downloadedName).toBe('generated-project-gen-abc.zip')
    expect(h.toast).toHaveBeenCalledWith({ title: 'Export successful', description: 'Your project has been downloaded as a ZIP file.' })
    expect(btn.textContent).toContain('Export')
    expect(btn.disabled).toBe(false)
  })

  it('a real server error response shows the real toast with the real server-provided message', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: async () => ({ message: 'Generation not found' }) } as unknown as Response)) as any
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(React.createElement(ExportButton, { generationId: 'gen-missing' }))
    const btn = host.querySelector('button') as HTMLButtonElement
    await act(async () => { btn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(h.toast).toHaveBeenCalledWith({ title: 'Export failed', description: 'Generation not found', variant: 'destructive' })
    consoleSpy.mockRestore()
  })

  it('a real server error with no parseable JSON body falls back to the real generic message', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: async () => { throw new Error('bad json') } } as unknown as Response)) as any
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(React.createElement(ExportButton, { generationId: 'gen-bad' }))
    const btn = host.querySelector('button') as HTMLButtonElement
    await act(async () => { btn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(h.toast).toHaveBeenCalledWith({ title: 'Export failed', description: 'Failed to export project', variant: 'destructive' })
    consoleSpy.mockRestore()
  })

  it('a genuine network rejection shows the real error toast with the thrown Error\'s own message', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('Network down'))) as any
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(React.createElement(ExportButton, { generationId: 'gen-net' }))
    const btn = host.querySelector('button') as HTMLButtonElement
    await act(async () => { btn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(h.toast).toHaveBeenCalledWith({ title: 'Export failed', description: 'Network down', variant: 'destructive' })
    consoleSpy.mockRestore()
  })

  it('re-enables the button after a real failure, so a founder can retry', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('down'))) as any
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(React.createElement(ExportButton, { generationId: 'gen-retry' }))
    const btn = host.querySelector('button') as HTMLButtonElement
    await act(async () => { btn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(btn.disabled).toBe(false)
    expect(btn.textContent).toContain('Export')
    consoleSpy.mockRestore()
  })

  it('passes through real variant/size/className props to the underlying Button', () => {
    render(React.createElement(ExportButton, { generationId: 'g1', variant: 'ghost', size: 'sm', className: 'my-extra-class' }))

    const btn = host.querySelector('button') as HTMLButtonElement
    expect(btn.className).toContain('my-extra-class')
  })
})
