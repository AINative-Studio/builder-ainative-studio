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
 * /design-tokens — cross-token version/usage summary (#1213). The real UI
 * consumer for the previously orphaned GET /api/design-tokens/versions.
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
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }
}

describe('/design-tokens — version/usage summary (#1213)', () => {
  it('shows real aggregate counts once /api/design-tokens/versions resolves', async () => {
    global.fetch = fetchRouter({
      '/api/design-tokens/versions': () => ({
        ok: true,
        json: async () => ({
          success: true,
          tokens: [
            { name: 'Acme Brand', totalVersions: 2, activeVersion: '1.0.0', versions: [{ generationCount: 3 }, { generationCount: 1 }] },
            { name: 'Side Project', totalVersions: 1, activeVersion: '1.0.0', versions: [{ generationCount: 0 }] },
          ],
        }),
      }),
      '/api/design-tokens': () => ({ ok: true, json: async () => ({ tokens: [] }) }),
    }) as any

    await render()

    const summary = host.querySelector('[data-testid="design-tokens-version-summary"]')
    expect(summary).not.toBeNull()
    expect(summary?.textContent).toContain('2') // 2 token families
    expect(summary?.textContent).toContain('3') // 3 total versions (2+1)
    expect(summary?.textContent).toContain('4') // 4 generations (3+1+0)
  })

  it('renders fine (no summary panel) when the versions route has nothing yet', async () => {
    global.fetch = fetchRouter({
      '/api/design-tokens/versions': () => ({ ok: true, json: async () => ({ success: true, tokens: [] }) }),
      '/api/design-tokens': () => ({ ok: true, json: async () => ({ tokens: [] }) }),
    }) as any

    await render()

    expect(host.querySelector('[data-testid="design-tokens-version-summary"]')).toBeNull()
    expect(host.textContent).toContain('Design Tokens')
  })
})
