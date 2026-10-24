// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { SkillBrowser } from '@/components/skills/skill-browser'
import type { SkillMetadata, SkillContext, AgentSkill } from '@/lib/types/agent-skills'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom gap — Radix Select's internals call this when an item is
  // highlighted/opened (established polyfill, reused from
  // context-items-list-render-1204.test.tsx earlier this pass).
  Element.prototype.scrollIntoView = vi.fn()
})

/**
 * #1204 (Coverage Phase 4) — SkillBrowser (components/skills/skill-browser.tsx,
 * 406 lines, reached live via app/settings/skills/page.tsx) had zero test
 * coverage. The sibling SkillEditor in the same directory was checked and
 * confirmed genuinely orphaned (grep -rln across the whole repo finds it
 * nowhere but its own file + the shared prop-type definition) — skipped per
 * established dead-code practice, not tested.
 */

function makeSkill(overrides: Partial<SkillMetadata> = {}): SkillMetadata {
  return {
    id: 'skill-1',
    name: 'TDD Patterns',
    description: 'Test-driven development patterns and practices',
    version: '1.0.0',
    author: { id: 'system', name: 'System' },
    tags: ['testing', 'tdd'],
    tokenCost: { metadata: 100, full: 2000 },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

function jsonResponse(data: any, ok = true) {
  return Promise.resolve({ ok, json: async () => data } as Response)
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
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('SkillBrowser — real fetch/search/filter/recommend coverage (#1204)', () => {
  it('shows the real loading skeleton grid before the initial /api/skills fetch resolves', async () => {
    let resolveFetch: (v: any) => void = () => {}
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve })) as any

    render(React.createElement(SkillBrowser, { onSkillSelect: vi.fn() }))

    expect(host.querySelector('[data-testid="skill-browser-loading"]')).not.toBeNull()

    await act(async () => { resolveFetch(await jsonResponse({ skills: [] })); await Promise.resolve() })
  })

  it('fetches the real base listing, then runs the real debounced search and renders returned skills', async () => {
    const skill = makeSkill()
    global.fetch = vi.fn((url: string) => {
      const u = String(url)
      if (u.startsWith('/api/skills/search')) return jsonResponse({ skills: [skill] })
      if (u === '/api/skills') return jsonResponse({ skills: [skill] })
      return jsonResponse({ skills: [] })
    }) as any

    render(React.createElement(SkillBrowser, { onSkillSelect: vi.fn() }))
    await flush()
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })

    expect(global.fetch).toHaveBeenCalledWith('/api/skills')
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/skills/search?'))
    expect(host.textContent).toContain('TDD Patterns')
    expect(host.textContent).toContain('v1.0.0')
    expect(host.textContent).toContain('2000 tokens')
  })

  it('shows the real "No skills found" empty state when search returns genuinely nothing', async () => {
    global.fetch = vi.fn((url: string) => {
      const u = String(url)
      if (u.startsWith('/api/skills/search')) return jsonResponse({ skills: [] })
      return jsonResponse({ skills: [] })
    }) as any

    render(React.createElement(SkillBrowser, { onSkillSelect: vi.fn() }))
    await flush()
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })

    expect(host.textContent).toContain('No skills found')
  })

  it('renders the real unique tag chips derived from the base /api/skills listing, and clicking one re-searches with it', async () => {
    const s1 = makeSkill({ id: 's1', tags: ['testing', 'tdd'] })
    const s2 = makeSkill({ id: 's2', name: 'React Patterns', tags: ['react', 'tdd'] })
    const searchMock = vi.fn((_url: string) => jsonResponse({ skills: [s1, s2] }))
    global.fetch = vi.fn((url: string) => {
      const u = String(url)
      if (u.startsWith('/api/skills/search')) return searchMock(u)
      if (u === '/api/skills') return jsonResponse({ skills: [s1, s2] })
      return jsonResponse({ skills: [] })
    }) as any

    render(React.createElement(SkillBrowser, { onSkillSelect: vi.fn() }))
    await flush()
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })

    const tagBadges = Array.from(host.querySelectorAll('.cursor-pointer')).filter((el) =>
      ['testing', 'tdd', 'react'].includes(el.textContent?.trim() || ''),
    )
    expect(tagBadges.map((b) => b.textContent?.trim()).sort()).toEqual(['react', 'tdd', 'testing'])

    searchMock.mockClear()
    const reactTag = tagBadges.find((b) => b.textContent?.trim() === 'react') as HTMLElement
    await act(async () => { reactTag.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })

    expect(searchMock).toHaveBeenCalledWith(expect.stringContaining('tags=react'))
  })

  it('a real "built-in" tab click filters the already-fetched search results by the real is_built_in flag from /api/skills', async () => {
    const builtIn = makeSkill({ id: 'builtin-1', name: 'Builtin Skill' })
    const custom = makeSkill({ id: 'custom-1', name: 'Custom Skill' })
    global.fetch = vi.fn((url: string) => {
      const u = String(url)
      if (u.startsWith('/api/skills/search')) return jsonResponse({ skills: [builtIn, custom] })
      if (u === '/api/skills') {
        return jsonResponse({ skills: [{ ...builtIn, is_built_in: true }, { ...custom, is_built_in: false }] })
      }
      return jsonResponse({ skills: [] })
    }) as any

    render(React.createElement(SkillBrowser, { onSkillSelect: vi.fn() }))
    await flush()
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })

    expect(host.textContent).toContain('Builtin Skill')
    expect(host.textContent).toContain('Custom Skill')

    const builtInTab = Array.from(host.querySelectorAll('[role="tab"]')).find((t) => t.textContent === 'Built-in') as HTMLElement
    await act(async () => { builtInTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })

    expect(host.textContent).toContain('Builtin Skill')
    expect(host.textContent).not.toContain('Custom Skill')
  })

  it('clicking "Load Skill" fetches the real full skill detail and calls onSkillSelect with it', async () => {
    const skill = makeSkill()
    const fullSkill: AgentSkill = { metadata: skill, content: '# Full skill markdown' }
    global.fetch = vi.fn((url: string) => {
      const u = String(url)
      if (u === `/api/skills/${skill.id}`) return jsonResponse({ skill: fullSkill })
      if (u.startsWith('/api/skills/search')) return jsonResponse({ skills: [skill] })
      return jsonResponse({ skills: [skill] })
    }) as any
    const onSkillSelect = vi.fn()

    render(React.createElement(SkillBrowser, { onSkillSelect }))
    await flush()
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })

    const loadBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Load Skill') as HTMLButtonElement
    await act(async () => { loadBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith(`/api/skills/${skill.id}`)
    expect(onSkillSelect).toHaveBeenCalledWith(fullSkill)
  })

  it('never POSTs /api/skills/recommend when currentContext has genuinely no sessionId', async () => {
    const fetchMock = vi.fn((url: string) => {
      const u = String(url)
      if (u.startsWith('/api/skills/search') || u === '/api/skills') return jsonResponse({ skills: [] })
      return jsonResponse({})
    })
    global.fetch = fetchMock as any

    render(React.createElement(SkillBrowser, { onSkillSelect: vi.fn(), currentContext: { projectId: 'p1' } as unknown as SkillContext }))
    await flush()

    expect(fetchMock).not.toHaveBeenCalledWith('/api/skills/recommend', expect.anything())
  })

  it('a real currentContext with sessionId POSTs /api/skills/recommend and renders the returned recommendations', async () => {
    const recSkill = makeSkill({ id: 'rec-1', name: 'Recommended Skill' })
    const context: SkillContext = { sessionId: 'sess-1', userId: 'u1', projectId: 'proj-1' }
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url)
      if (u === '/api/skills/recommend' && init?.method === 'POST') {
        return jsonResponse({ recommendations: [{ skill: recSkill, reason: 'matches your current file', confidence: 0.87, autoLoad: false }] })
      }
      if (u.startsWith('/api/skills/search') || u === '/api/skills') return jsonResponse({ skills: [] })
      return jsonResponse({})
    }) as any

    render(React.createElement(SkillBrowser, { onSkillSelect: vi.fn(), currentContext: context }))
    await flush()

    expect(global.fetch).toHaveBeenCalledWith('/api/skills/recommend', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'sess-1', projectId: 'proj-1', currentFile: undefined, gitContext: undefined, tokenBudget: undefined,
      }),
    }))
    expect(host.querySelector('[data-testid="skill-recommendations"]')).not.toBeNull()
    expect(host.textContent).toContain('Recommended Skill')
    expect(host.textContent).toContain('87%')
  })

  it('shows the real token-budget line only when currentContext genuinely carries one', async () => {
    global.fetch = vi.fn(() => jsonResponse({ skills: [] })) as any

    render(React.createElement(SkillBrowser, {
      onSkillSelect: vi.fn(),
      currentContext: { sessionId: 's1', userId: 'u1', tokenBudget: { total: 1000, used: 400, remaining: 600 } },
    }))
    await flush()

    expect(host.textContent).toContain('600 / 1000 tokens remaining')
  })

  it('never shows a token-budget line when currentContext has none', async () => {
    global.fetch = vi.fn(() => jsonResponse({ skills: [] })) as any

    render(React.createElement(SkillBrowser, { onSkillSelect: vi.fn() }))
    await flush()

    expect(host.textContent).not.toContain('tokens remaining')
  })
})
