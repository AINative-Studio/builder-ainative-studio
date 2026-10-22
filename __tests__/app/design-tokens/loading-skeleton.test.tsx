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
 * /design-tokens (#1190) — the token table rendered a plain "Loading design
 * tokens..." text string while fetching, no placeholder shape at all. Now it
 * shows a skeleton table matching the real columns (Name/Version/Created/
 * Status/Actions).
 */

vi.mock('@/components/design-tokens/upload-dialog', () => ({ DesignTokenUploadDialog: () => null }))
vi.mock('@/components/design-tokens/preview', () => ({ DesignTokenPreview: () => null }))
vi.mock('@/components/design-tokens/version-history', () => ({ VersionHistory: () => null }))

import DesignTokensPage from '@/app/design-tokens/page'

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

async function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(React.createElement(DesignTokensPage)) })
}

async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }
}

describe('/design-tokens — skeleton loading state (#1190)', () => {
  it('shows a table-shaped skeleton while the tokens request is in flight', async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any

    await render()

    const skeleton = host.querySelector('[data-testid="design-tokens-loading"]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(host.textContent).not.toContain('Loading design tokens...')
  })

  it('replaces the skeleton with the real table once tokens load', async () => {
    global.fetch = fetchRouter({
      '/api/design-tokens/versions': () => ({ ok: true, json: async () => ({ success: true, tokens: [] }) }),
      '/api/design-tokens': () => ({
        ok: true,
        json: async () => ({
          tokens: [
            {
              id: 't1',
              name: 'Acme Brand',
              currentVersion: '1.0.0',
              createdAt: new Date().toISOString(),
              isActive: true,
            },
          ],
        }),
      }),
    }) as any

    await render()
    await flush()

    expect(host.querySelector('[data-testid="design-tokens-loading"]')).toBeNull()
    expect(host.textContent).toContain('Acme Brand')
  })
})
