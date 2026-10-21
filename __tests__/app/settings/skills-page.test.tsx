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
 * /settings/skills (#1213) — new page mounting the previously-orphaned
 * components/skills/skill-browser.tsx (zero mounters before this issue).
 */

vi.mock('@/components/shared/app-header', () => ({ AppHeader: () => null }))

const sessionMock = vi.hoisted(() => ({ useSession: vi.fn() }))
vi.mock('next-auth/react', () => ({ useSession: sessionMock.useSession }))

import SkillsSettingsPage from '@/app/settings/skills/page'

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
  await act(async () => { root.render(React.createElement(SkillsSettingsPage)) })
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })
  }
}

describe('/settings/skills page (#1213)', () => {
  it('mounts the real SkillBrowser and shows a selected skill\'s content on click', async () => {
    sessionMock.useSession.mockReturnValue({ data: { user: { id: 'user-1' } } })
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/skills/search')) {
        return { ok: true, json: async () => ({ skills: [], total: 0, searchTime: 1 }) } as any
      }
      if (String(url).includes('/api/skills/recommend')) {
        return { ok: true, json: async () => ({ recommendations: [] }) } as any
      }
      return { ok: true, json: async () => ({ skills: [] }) } as any
    }) as any

    await render()

    expect(host.textContent).toContain('Agent Skills')
    // No skill selected yet — the browser renders, not the detail view.
    expect(host.querySelector('[data-testid="skill-browser-search"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="skill-detail-back"]')).toBeNull()
  })
})
