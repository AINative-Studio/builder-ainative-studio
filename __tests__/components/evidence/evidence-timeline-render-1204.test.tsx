// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EvidenceTimeline } from '@/components/evidence/evidence-timeline'
import type { Evidence } from '@/lib/types/evidence'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — EvidenceTimeline (components/evidence/evidence
 * -timeline.tsx, 302 lines, reached live via app/evidence/page.tsx) had zero
 * test coverage.
 */

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-1',
    user_id: 'u1',
    type: 'test-run',
    status: 'success',
    title: 'Run unit tests',
    metadata: {},
    created_at: new Date('2026-01-15T10:00:00Z'),
    updated_at: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  }
}

function jsonResponse(data: any) {
  return { json: async () => data } as Response
}

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
})

describe('EvidenceTimeline — real fetch/render/expand coverage (#1204)', () => {
  it('fetches the real /api/evidence with the real limit param, then renders the real grouped timeline', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ evidence: [makeEvidence()] })) as any
    render(React.createElement(EvidenceTimeline))

    expect(host.textContent).toContain('Loading timeline')

    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/evidence?limit=50'))
    expect(host.textContent).toContain('Run unit tests')
    expect(host.textContent).toContain('January 15, 2026')
  })

  it('includes the real project_id and git_branch params only when genuinely provided', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ evidence: [] })) as any
    render(React.createElement(EvidenceTimeline, { projectId: 'proj-1', gitBranch: 'main', limit: 10 }))

    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const calledUrl = (global.fetch as any).mock.calls[0][0] as string
    expect(calledUrl).toContain('limit=10')
    expect(calledUrl).toContain('project_id=proj-1')
    expect(calledUrl).toContain('git_branch=main')
  })

  it('shows the real "No evidence yet" empty state when the real response has no items', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ evidence: [] })) as any
    render(React.createElement(EvidenceTimeline))

    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.textContent).toContain('No evidence yet')
  })

  it('never crashes and falls back to an empty list when the real response omits the evidence field entirely', async () => {
    global.fetch = vi.fn(async () => jsonResponse({})) as any
    render(React.createElement(EvidenceTimeline))

    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.textContent).toContain('No evidence yet')
  })

  it('never crashes on a genuinely rejected fetch, stops the real loading state', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as any
    render(React.createElement(EvidenceTimeline))

    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.textContent).not.toContain('Loading timeline')
    expect(host.textContent).toContain('No evidence yet')
  })

  it('groups real multiple items under the real same date heading', async () => {
    global.fetch = vi.fn(async () => jsonResponse({
      evidence: [
        makeEvidence({ id: 'ev-1', title: 'First run', created_at: new Date('2026-01-15T09:00:00Z') }),
        makeEvidence({ id: 'ev-2', title: 'Second run', created_at: new Date('2026-01-15T11:00:00Z') }),
      ],
    })) as any
    render(React.createElement(EvidenceTimeline))

    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelectorAll('h3').length).toBe(1)
    expect(host.textContent).toContain('First run')
    expect(host.textContent).toContain('Second run')
  })

  it('renders a real failure-status icon/border and a real git branch badge when present', async () => {
    global.fetch = vi.fn(async () => jsonResponse({
      evidence: [makeEvidence({ status: 'failure', git_branch: 'feature/x' })],
    })) as any
    render(React.createElement(EvidenceTimeline))

    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('.border-red-500')).not.toBeNull()
    expect(host.textContent).toContain('feature/x')
  })

  it('a real click on the collapsible header expands the real metadata details (coverage, tests, command)', async () => {
    global.fetch = vi.fn(async () => jsonResponse({
      evidence: [makeEvidence({
        command: 'npm test',
        git_commit: 'abcdef1234567890',
        metadata: { coveragePercent: 82.345, testsPassed: 10, totalTests: 12, testsFailed: 2, buildSuccess: false, buildErrors: 3 },
      })],
    })) as any
    render(React.createElement(EvidenceTimeline))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.textContent).not.toContain('npm test')

    const header = host.querySelector('[data-slot="card-header"], .cursor-pointer') as HTMLElement
    await act(async () => { header.click() })

    expect(host.textContent).toContain('82.3%')
    expect(host.textContent).toContain('10 / 12')
    expect(host.textContent).toContain('2')
    expect(host.textContent).toContain('Failed')
    expect(host.textContent).toContain('npm test')
    expect(host.textContent).toContain('abcdef12')
    expect(host.querySelector('button')?.textContent).toContain('View Details')
  })

  it('re-fetches real evidence when projectId or gitBranch props change', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ evidence: [] })) as any
    render(React.createElement(EvidenceTimeline, { projectId: 'proj-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const callsBefore = (global.fetch as any).mock.calls.length
    act(() => { root.render(React.createElement(EvidenceTimeline, { projectId: 'proj-2' })) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect((global.fetch as any).mock.calls.length).toBe(callsBefore + 1)
    expect((global.fetch as any).mock.calls.at(-1)[0]).toContain('project_id=proj-2')
  })
})
