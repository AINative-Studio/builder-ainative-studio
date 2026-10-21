// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { SWRConfig } from 'swr'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * /insights export button (#1213) — the real UI consumer for the
 * previously-orphaned GET /api/rlhf/export, added to the existing RLHF
 * insights dashboard rather than a new page since it's the exact same data
 * domain the page already visualizes.
 */

vi.mock('@/components/shared/app-header', () => ({ AppHeader: () => null }))

import InsightsPage from '@/app/insights/page'

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
  await act(async () => {
    root.render(
      React.createElement(
        SWRConfig,
        { value: { provider: () => new Map() } },
        React.createElement(InsightsPage),
      ),
    )
  })
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }
}

describe('Insights page — RLHF export button (#1213)', () => {
  it('triggers a download of the real export route for an admin caller', async () => {
    const createObjectURLSpy = vi.fn(() => 'blob:fake-url')
    ;(window.URL as any).createObjectURL = createObjectURLSpy
    ;(window.URL as any).revokeObjectURL = vi.fn()
    // jsdom doesn't implement real navigation — stub the click so the
    // download-trigger anchor doesn't log a "Not implemented: navigation" error.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/rlhf/export')) {
        return { ok: true, blob: async () => new Blob(['{}']) } as any
      }
      return { ok: true, json: async () => ({ summary: {} }) } as any
    }) as any

    await render()

    const btn = host.querySelector('[data-testid="rlhf-export-button"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    await act(async () => { btn.click() })
    await act(async () => { await Promise.resolve() })

    expect(createObjectURLSpy).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    expect(host.querySelector('[data-testid="rlhf-export-error"]')).toBeNull()
    clickSpy.mockRestore()
  })

  it('shows an inline error (not a silent failure) when the admin gate rejects the export', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/rlhf/export')) {
        return { ok: false, status: 403, json: async () => ({ error: 'Admin access required' }) } as any
      }
      return { ok: true, json: async () => ({ summary: {} }) } as any
    }) as any

    await render()

    const btn = host.querySelector('[data-testid="rlhf-export-button"]') as HTMLButtonElement
    await act(async () => { btn.click() })
    await act(async () => { await Promise.resolve() })

    expect(host.querySelector('[data-testid="rlhf-export-error"]')?.textContent).toMatch(/admin access required/i)
  })
})
