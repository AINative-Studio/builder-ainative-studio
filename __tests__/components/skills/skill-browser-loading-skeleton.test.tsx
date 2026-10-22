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
 * components/skills/skill-browser.tsx (#1190) — the skills grid rendered a
 * bare spinner while /api/skills was in flight, with no shape resembling the
 * card grid underneath. Now it shows skeleton cards matching SkillCard's
 * real layout (title/version/token-cost, description lines, tag chips,
 * button).
 */

import { SkillBrowser } from '@/components/skills/skill-browser'

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
    root.render(React.createElement(SkillBrowser, { onSkillSelect: vi.fn() } as any))
  })
}

async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })
  }
}

describe('SkillBrowser — skeleton loading state (#1190)', () => {
  it('shows card-shaped skeletons while /api/skills is in flight', async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any

    await render()

    const skeleton = host.querySelector('[data-testid="skill-browser-loading"]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(host.textContent).not.toContain('Loading skills...')
  })

  it('replaces the skeleton with real skill cards once they load', async () => {
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
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/skills')) {
        return { ok: true, json: async () => ({ skills: [baseSkill] }) }
      }
      return { ok: true, json: async () => ({}) }
    }) as any

    await render()
    await flush()

    expect(host.querySelector('[data-testid="skill-browser-loading"]')).toBeNull()
    expect(host.textContent).toContain('Mandatory TDD')
  })
})
