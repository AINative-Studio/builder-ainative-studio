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
 * #1204 (Coverage Phase 4) — Swarm.tsx (components/build/artifacts/Swarm.tsx)
 * had zero render coverage. The real behavior worth asserting: the honest
 * real-vs-preview badge never claims a live agent-swarm run unless /api/build/
 * swarm actually said so (core#6422 — the endpoint can be gated/down and this
 * must degrade honestly, never fabricate a live run), and the static 5-agent
 * grid's shipped count is correct. useBuild mocked at its real context
 * boundary, same convention as app-artifacts-render-1204.test.tsx.
 */

const h = vi.hoisted(() => ({ state: {} as Record<string, any> }))
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: h.state }),
}))

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function flush() {
  return act(async () => { await Promise.resolve(); await Promise.resolve() })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.restoreAllMocks()
})

async function importSwarm() {
  const mod = await import('@/components/build/artifacts/Swarm')
  return mod.Swarm
}

describe('Swarm — honest real-vs-preview badge (#1204)', () => {
  it('shows "preview run" (never "live agent-swarm run") while the real-swarm fetch is still in flight', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})))
    h.state = { idea: 'A CRM for plumbers' }

    const Swarm = await importSwarm()
    render(React.createElement(Swarm))
    await flush()

    expect(host.textContent).toContain('preview run')
    expect(host.textContent).not.toContain('live agent-swarm run')
  })

  it('shows "preview run" when the real-swarm endpoint is gated/down (non-ok response) — never fabricates a live run (core#6422)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    h.state = { idea: 'A CRM for plumbers' }

    const Swarm = await importSwarm()
    render(React.createElement(Swarm))
    await flush()

    expect(host.textContent).toContain('preview run')
    expect(host.textContent).not.toContain('live agent-swarm run')
  })

  it('shows the real "live agent-swarm run" badge with the real taskId once the swarm endpoint confirms real:true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ real: true, taskId: 'task-abcdef123456' }) }))
    h.state = { idea: 'A CRM for plumbers' }

    const Swarm = await importSwarm()
    render(React.createElement(Swarm))
    await flush()

    expect(host.textContent).toContain('live agent-swarm run')
    expect(host.textContent).toContain('task-abc') // taskId sliced to 8 chars
    expect(host.querySelector('.m-swarm-badge.is-real')).not.toBeNull()
  })

  it('shows "preview run" when the endpoint resolves ok but real:false (free tier, no swarm attempted)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ real: false }) }))
    h.state = { idea: 'A CRM for plumbers' }

    const Swarm = await importSwarm()
    render(React.createElement(Swarm))
    await flush()

    expect(host.querySelector('.m-swarm-badge.is-preview')).not.toBeNull()
    expect(host.querySelector('.m-swarm-badge.is-real')).toBeNull()
  })

  it('posts the real idea (not a placeholder) to /api/build/swarm with all 5 agent types', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ real: false }) })
    vi.stubGlobal('fetch', fetchMock)
    h.state = { idea: 'A booking app for yoga studios' }

    const Swarm = await importSwarm()
    render(React.createElement(Swarm))
    await flush()

    expect(fetchMock).toHaveBeenCalledWith('/api/build/swarm', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.description).toContain('A booking app for yoga studios')
    expect(body.agentTypes).toEqual(['architect', 'backend', 'frontend', 'qa', 'security'])
  })
})

describe('Swarm — static 5-agent grid (#1204)', () => {
  it('renders exactly 5 agent cards with the real fixture shipped-count (1/5 done)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ real: false }) }))
    h.state = { idea: 'anything' }

    const Swarm = await importSwarm()
    render(React.createElement(Swarm))
    await flush()

    const cards = host.querySelectorAll('.m-agent')
    expect(cards.length).toBe(5)
    expect(host.textContent).toContain('1 / 5 agents shipped')
  })

  it('marks only the Architect card as done (✓) and the rest as working/idle per their real badges', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ real: false }) }))
    h.state = { idea: 'anything' }

    const Swarm = await importSwarm()
    render(React.createElement(Swarm))
    await flush()

    expect(host.querySelectorAll('.m-agent-badge.is-done').length).toBe(1)
    expect(host.querySelectorAll('.m-agent-badge.is-working').length).toBe(3)
    expect(host.querySelectorAll('.m-agent-badge.is-idle').length).toBe(1)
  })
})
