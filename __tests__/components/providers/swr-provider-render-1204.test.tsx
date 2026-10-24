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
 * #1204 (Coverage Phase 4) — SWRProvider (components/providers/swr-provider.tsx,
 * 41 lines, reached live via app/layout.tsx — global on every page) had zero
 * test coverage. SWRConfig itself is the real, battle-tested third-party swr
 * library — mocked here at its real exported boundary (@/node_modules'
 * real swr package) to capture the config object this provider builds, so
 * this test verifies SWRProvider's OWN fetcher/options logic, not swr's
 * internals.
 */

const h = vi.hoisted(() => ({ lastConfigValue: null as any }))
vi.mock('swr', () => ({
  SWRConfig: (props: any) => {
    h.lastConfigValue = props.value
    return React.createElement('div', { 'data-testid': 'stub-swr-config' }, props.children)
  },
}))

import { SWRProvider } from '@/components/providers/swr-provider'

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
  vi.restoreAllMocks()
  h.lastConfigValue = null
})

describe('SWRProvider — real fetcher/config/children coverage (#1204)', () => {
  it('renders the real children inside the real SWRConfig', () => {
    render(React.createElement(SWRProvider, { children: React.createElement('span', { 'data-testid': 'child' }, 'hello') }))

    expect(host.querySelector('[data-testid="child"]')?.textContent).toBe('hello')
  })

  it('passes the real documented SWR options (revalidate/refresh/retry) to SWRConfig', () => {
    render(React.createElement(SWRProvider, { children: null }))

    expect(h.lastConfigValue).toMatchObject({
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 0,
      errorRetryCount: 3,
      errorRetryInterval: 5000,
    })
    expect(typeof h.lastConfigValue.fetcher).toBe('function')
  })

  it('the real fetcher resolves with the real parsed JSON body on a successful response', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ hello: 'world' }) } as unknown as Response)) as any
    render(React.createElement(SWRProvider, { children: null }))

    const result = await h.lastConfigValue.fetcher('/api/thing')

    expect(global.fetch).toHaveBeenCalledWith('/api/thing')
    expect(result).toEqual({ hello: 'world' })
  })

  it('the real fetcher throws a real Error carrying the real response status on a non-ok response', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'not found' }) } as unknown as Response)) as any
    render(React.createElement(SWRProvider, { children: null }))

    await expect(h.lastConfigValue.fetcher('/api/missing')).rejects.toMatchObject({
      message: 'An error occurred while fetching the data.',
      status: 404,
    })
  })

  it('the real fetcher error carries an info field resolving to the real response body', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ detail: 'server exploded' }) } as unknown as Response)) as any
    render(React.createElement(SWRProvider, { children: null }))

    try {
      await h.lastConfigValue.fetcher('/api/broken')
      expect.fail('fetcher should have thrown')
    } catch (err: any) {
      await expect(err.info).resolves.toEqual({ detail: 'server exploded' })
    }
  })
})
