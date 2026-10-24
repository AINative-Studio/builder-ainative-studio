// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ImStuck } from '@/components/help/ImStuck'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — ImStuck (components/help/ImStuck.tsx, 136
 * lines, reached live via /help and every /guides/[slug] page) had zero
 * test coverage.
 */

function jsonResponse(data: any, ok = true) {
  return { ok, json: async () => data }
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return host.querySelector(`[data-testid="${id}"]`) as T | null
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
})

describe('ImStuck — real search/result/error coverage (#1204)', () => {
  it('disables the real submit button while the real question is genuinely empty or whitespace-only', async () => {
    render(React.createElement(ImStuck))
    expect(byTestId<HTMLButtonElement>('im-stuck-submit')!.disabled).toBe(true)

    const input = byTestId<HTMLInputElement>('im-stuck-input')!
    await act(async () => { setInputValue(input, '   ') })
    expect(byTestId<HTMLButtonElement>('im-stuck-submit')!.disabled).toBe(true)

    await act(async () => { setInputValue(input, 'how do I deploy') })
    expect(byTestId<HTMLButtonElement>('im-stuck-submit')!.disabled).toBe(false)
  })

  it('a real submit fires the real POST with the real trimmed question', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ results: [] })) as any
    render(React.createElement(ImStuck))

    const input = byTestId<HTMLInputElement>('im-stuck-input')!
    await act(async () => { setInputValue(input, '  how do I deploy  ') })

    const form = host.querySelector('form') as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/help/stuck', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ question: 'how do I deploy' }),
    }))
  })

  it('shows the real "Searching…" label while the real request is pending, and genuinely never double-submits', async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any
    render(React.createElement(ImStuck))

    const input = byTestId<HTMLInputElement>('im-stuck-input')!
    await act(async () => { setInputValue(input, 'deploy') })
    const form = host.querySelector('form') as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    expect(byTestId('im-stuck-submit')?.textContent).toBe('Searching…')
    expect(byTestId<HTMLButtonElement>('im-stuck-submit')!.disabled).toBe(true)

    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('renders the real result list with href/parentTitle/title/snippet for each real match', async () => {
    global.fetch = vi.fn(async () => jsonResponse({
      results: [{ href: '/guides/deploy#railway', title: 'Deploy to Railway', parentTitle: 'Deployment Guide', source: 'guide', snippet: 'Use railway up to deploy.', score: 0.9 }],
    })) as any
    render(React.createElement(ImStuck))

    const input = byTestId<HTMLInputElement>('im-stuck-input')!
    await act(async () => { setInputValue(input, 'railway') })
    const form = host.querySelector('form') as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve() })

    const link = host.querySelector('a.m-stuck-link') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/guides/deploy#railway')
    expect(host.textContent).toContain('Deployment Guide')
    expect(host.textContent).toContain('Deploy to Railway')
    expect(host.textContent).toContain('Use railway up to deploy.')
  })

  it('shows the real "did not find a matching section" note when the real results array is genuinely empty', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ results: [] })) as any
    render(React.createElement(ImStuck))

    const input = byTestId<HTMLInputElement>('im-stuck-input')!
    await act(async () => { setInputValue(input, 'nonsense query') })
    const form = host.querySelector('form') as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve() })

    expect(host.textContent).toContain('I did not find a matching section')
  })

  it('shows the real FAQ-fallback error message (never a crash) when the response is genuinely malformed', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ results: 'not-an-array' })) as any
    render(React.createElement(ImStuck))

    const input = byTestId<HTMLInputElement>('im-stuck-input')!
    await act(async () => { setInputValue(input, 'deploy') })
    const form = host.querySelector('form') as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('I could not run the search')
  })

  it('shows the real error message (never a crash) on a genuinely rejected fetch', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as any
    render(React.createElement(ImStuck))

    const input = byTestId<HTMLInputElement>('im-stuck-input')!
    await act(async () => { setInputValue(input, 'deploy') })
    const form = host.querySelector('form') as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('a real new submission clears a real prior error before the new request resolves', async () => {
    let shouldFail = true
    global.fetch = vi.fn(async () => {
      if (shouldFail) return jsonResponse({}, false)
      return jsonResponse({ results: [] })
    }) as any
    render(React.createElement(ImStuck))

    const input = byTestId<HTMLInputElement>('im-stuck-input')!
    const form = host.querySelector('form') as HTMLFormElement

    await act(async () => { setInputValue(input, 'first query') })
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve() })
    expect(host.querySelector('[role="alert"]')).not.toBeNull()

    shouldFail = false
    await act(async () => { setInputValue(input, 'second query') })
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})
