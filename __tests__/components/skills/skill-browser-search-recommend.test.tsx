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
 * components/skills/skill-browser.tsx (#1213) — was fully built and
 * functional but had zero mounters anywhere, and its own search box only
 * ever filtered a single full fetch client-side, never calling the real
 * GET /api/skills/search. Also wires POST /api/skills/recommend as a
 * "Recommended for you" strip when a real session context is given.
 */

import { SkillBrowser } from '@/components/skills/skill-browser'

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

async function render(props: Partial<React.ComponentProps<typeof SkillBrowser>> = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(SkillBrowser, { onSkillSelect: vi.fn(), ...props } as any))
  })
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })
  }
}

const baseSkill = {
  id: 's1',
  name: 'Mandatory TDD',
  description: 'Enforces TDD',
  version: '1.0.0',
  tags: ['tdd'],
  is_built_in: true,
  createdAt: new Date().toISOString(),
  tokenCost: { metadata: 100, full: 2000 },
}

describe('SkillBrowser — real search wiring (#1213)', () => {
  it('fetches /api/skills for the base list and /api/skills/search for results', async () => {
    const fetchMock = fetchRouter({
      '/api/skills/search': () => ({ ok: true, json: async () => ({ skills: [baseSkill], total: 1, searchTime: 1 }) }),
      '/api/skills': () => ({ ok: true, json: async () => ({ skills: [baseSkill] }) }),
    })
    global.fetch = fetchMock as any

    await render()

    const calledUrls = fetchMock.mock.calls.map((c: any[]) => String(c[0]))
    expect(calledUrls.some((u: string) => u.includes('/api/skills/search'))).toBe(true)
    expect(host.textContent).toContain('Mandatory TDD')
  })

  it('sends the search box text as a real query param to /api/skills/search', async () => {
    const fetchMock = fetchRouter({
      '/api/skills/search': () => ({ ok: true, json: async () => ({ skills: [], total: 0, searchTime: 1 }) }),
      '/api/skills': () => ({ ok: true, json: async () => ({ skills: [baseSkill] }) }),
    })
    global.fetch = fetchMock as any

    await render()

    const input = host.querySelector('[data-testid="skill-browser-search"]') as HTMLInputElement
    await act(async () => {
      input.dispatchEvent(new Event('focus'))
    })
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, 'tdd')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 300)) })

    const searchCalls = fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes('/api/skills/search'))
    const last = searchCalls[searchCalls.length - 1]
    expect(String(last[0])).toContain('query=tdd')
  })

  it('shows a recommendations strip only when a real session context is provided', async () => {
    const fetchMock = fetchRouter({
      '/api/skills/recommend': () => ({
        ok: true,
        json: async () => ({ recommendations: [{ skill: baseSkill, reason: 'matches your recent files', confidence: 0.8, autoLoad: true }] }),
      }),
      '/api/skills/search': () => ({ ok: true, json: async () => ({ skills: [baseSkill], total: 1, searchTime: 1 }) }),
      '/api/skills': () => ({ ok: true, json: async () => ({ skills: [baseSkill] }) }),
    })
    global.fetch = fetchMock as any

    await render({ currentContext: { sessionId: 'sess-1', userId: 'user-1' } as any })

    expect(host.querySelector('[data-testid="skill-recommendations"]')).not.toBeNull()
    expect(host.textContent).toContain('80%')
  })

  it('does not call /api/skills/recommend at all without a real context', async () => {
    const fetchMock = fetchRouter({
      '/api/skills/search': () => ({ ok: true, json: async () => ({ skills: [], total: 0, searchTime: 1 }) }),
      '/api/skills': () => ({ ok: true, json: async () => ({ skills: [] }) }),
    })
    global.fetch = fetchMock as any

    await render()

    const calledUrls = fetchMock.mock.calls.map((c: any[]) => String(c[0]))
    expect(calledUrls.some((u: string) => u.includes('/api/skills/recommend'))).toBe(false)
  })
})
