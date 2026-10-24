// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EvidenceGallery } from '@/components/evidence/evidence-gallery'
import type { Evidence } from '@/lib/types/evidence'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView = vi.fn()
})

/**
 * #1204 (Coverage Phase 4) — EvidenceGallery (components/evidence/
 * evidence-gallery.tsx, 362 lines, reached live via app/evidence/page.tsx)
 * had only narrow coverage from evidence-gallery-download.test.tsx (#1213,
 * the Download button only). This covers the remaining real surface: real
 * search/filter query params, loading/empty states, real metadata
 * rendering, status/type badges, View callback, pagination, and the Enter
 * key search shortcut.
 */

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-1', user_id: 'u1', type: 'test-run', status: 'success',
    title: 'Test run #1', metadata: {},
    created_at: new Date('2026-01-01T12:00:00Z') as any,
    updated_at: new Date('2026-01-01T12:00:00Z') as any,
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

describe('EvidenceGallery — real search/filter/pagination/metadata coverage (#1204)', () => {
  it('fetches the real default evidence list on mount with the real limit/offset params', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ evidence: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } }))
    global.fetch = fetchMock as any
    render(React.createElement(EvidenceGallery, {}))

    expect(host.textContent).toContain('Loading evidence...')
    await flush()

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('limit=20'))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('offset=0'))
  })

  it('shows the real empty state when genuinely no evidence is returned', async () => {
    global.fetch = vi.fn(() => jsonResponse({ evidence: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } })) as any
    render(React.createElement(EvidenceGallery, {}))
    await flush()

    expect(host.textContent).toContain('No evidence found')
  })

  it('includes the real projectId/gitBranch props as query params when given', async () => {
    const fetchMock = vi.fn((_url: string) => jsonResponse({ evidence: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } }))
    global.fetch = fetchMock as any
    render(React.createElement(EvidenceGallery, { projectId: 'proj-1', gitBranch: 'main' }))
    await flush()

    const calledUrl = fetchMock.mock.calls[0][0]
    expect(calledUrl).toContain('project_id=proj-1')
    expect(calledUrl).toContain('git_branch=main')
  })

  it('typing a search query and pressing Enter re-fetches with the real search param and resets offset', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ evidence: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } }))
    global.fetch = fetchMock as any
    render(React.createElement(EvidenceGallery, {}))
    await flush()

    const input = host.querySelector('input[placeholder="Search evidence..."]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input, 'coverage report'); input.dispatchEvent(new Event('input', { bubbles: true })) })

    fetchMock.mockClear()
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    await flush()

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('search=coverage+report'))
  })

  it('clicking Search also re-fetches with the real typed query', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ evidence: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } }))
    global.fetch = fetchMock as any
    render(React.createElement(EvidenceGallery, {}))
    await flush()

    const input = host.querySelector('input[placeholder="Search evidence..."]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input, 'deploy'); input.dispatchEvent(new Event('input', { bubbles: true })) })

    fetchMock.mockClear()
    const searchBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Search')) as HTMLButtonElement
    await act(async () => { searchBtn.click() })
    await flush()

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('search=deploy'))
  })

  it('a real type-filter selection re-fetches with the real type param', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ evidence: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } }))
    global.fetch = fetchMock as any
    render(React.createElement(EvidenceGallery, {}))
    await flush()

    fetchMock.mockClear()
    const triggers = Array.from(host.querySelectorAll('[role="combobox"]')) as HTMLElement[]
    await act(async () => { triggers[0].click() })
    const option = Array.from(document.body.querySelectorAll('[role="option"]')).find((o) => o.textContent === 'Coverage') as HTMLElement
    await act(async () => { option.click() })
    await flush()

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('type=coverage'))
  })

  it('a real status-filter selection re-fetches with the real status param', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ evidence: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } }))
    global.fetch = fetchMock as any
    render(React.createElement(EvidenceGallery, {}))
    await flush()

    fetchMock.mockClear()
    const triggers = Array.from(host.querySelectorAll('[role="combobox"]')) as HTMLElement[]
    await act(async () => { triggers[1].click() })
    const option = Array.from(document.body.querySelectorAll('[role="option"]')).find((o) => o.textContent === 'Failure') as HTMLElement
    await act(async () => { option.click() })
    await flush()

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('status=failure'))
  })

  it('renders the real metadata fields only when genuinely present on the item', async () => {
    const withMeta = makeEvidence({
      id: 'ev-meta', metadata: { coveragePercent: 87.456, testsPassed: 9, totalTests: 10, executionDuration: 1500 }, git_branch: 'feature/x',
    })
    global.fetch = vi.fn(() => jsonResponse({ evidence: [withMeta], pagination: { total: 1, limit: 20, offset: 0, hasMore: false } })) as any
    render(React.createElement(EvidenceGallery, {}))
    await flush()

    expect(host.textContent).toContain('87.5%')
    expect(host.textContent).toContain('9 / 10')
    expect(host.textContent).toContain('1.5s')
    expect(host.textContent).toContain('feature/x')
  })

  it('never renders a metadata row for a field that is genuinely absent', async () => {
    const bare = makeEvidence({ id: 'ev-bare', metadata: {} })
    global.fetch = vi.fn(() => jsonResponse({ evidence: [bare], pagination: { total: 1, limit: 20, offset: 0, hasMore: false } })) as any
    render(React.createElement(EvidenceGallery, {}))
    await flush()

    expect(host.textContent).not.toContain('Coverage:')
    expect(host.textContent).not.toContain('Tests:')
    expect(host.textContent).not.toContain('Duration:')
    expect(host.textContent).not.toContain('Branch:')
  })

  it('formats real durations under 1s in ms, under 1m in seconds, and over 1m in minutes', async () => {
    const items = [
      makeEvidence({ id: 'a', metadata: { executionDuration: 450 } }),
      makeEvidence({ id: 'b', metadata: { executionDuration: 2500 } }),
      makeEvidence({ id: 'c', metadata: { executionDuration: 90000 } }),
    ]
    global.fetch = vi.fn(() => jsonResponse({ evidence: items, pagination: { total: 3, limit: 20, offset: 0, hasMore: false } })) as any
    render(React.createElement(EvidenceGallery, {}))
    await flush()

    expect(host.textContent).toContain('450ms')
    expect(host.textContent).toContain('2.5s')
    expect(host.textContent).toContain('1.5m')
  })

  it('clicking View calls the real onEvidenceSelect with the full real evidence item', async () => {
    const item = makeEvidence({ id: 'ev-view', title: 'Build #42' })
    global.fetch = vi.fn(() => jsonResponse({ evidence: [item], pagination: { total: 1, limit: 20, offset: 0, hasMore: false } })) as any
    const onEvidenceSelect = vi.fn()
    render(React.createElement(EvidenceGallery, { onEvidenceSelect }))
    await flush()

    const viewBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('View')) as HTMLButtonElement
    await act(async () => { viewBtn.click() })

    expect(onEvidenceSelect).toHaveBeenCalledWith(item)
  })

  it('never shows pagination controls when total is genuinely within one page', async () => {
    global.fetch = vi.fn(() => jsonResponse({ evidence: [makeEvidence()], pagination: { total: 1, limit: 20, offset: 0, hasMore: false } })) as any
    render(React.createElement(EvidenceGallery, {}))
    await flush()

    expect(host.textContent).not.toContain('Previous')
  })

  it('shows the real pagination range and advances offset on Next, disables Previous at offset 0', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ evidence: [makeEvidence()], pagination: { total: 45, limit: 20, offset: 0, hasMore: true } }))
    global.fetch = fetchMock as any
    render(React.createElement(EvidenceGallery, {}))
    await flush()

    expect(host.textContent).toContain('Showing 1 - 20 of 45')
    const prevBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Previous') as HTMLButtonElement
    expect(prevBtn.disabled).toBe(true)

    fetchMock.mockClear()
    fetchMock.mockImplementation(() => jsonResponse({ evidence: [makeEvidence()], pagination: { total: 45, limit: 20, offset: 20, hasMore: true } }))
    const nextBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Next') as HTMLButtonElement
    await act(async () => { nextBtn.click() })
    await flush()

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('offset=20'))
  })

  it('disables Next when hasMore is genuinely false', async () => {
    global.fetch = vi.fn(() => jsonResponse({ evidence: [makeEvidence()], pagination: { total: 45, limit: 20, offset: 40, hasMore: false } })) as any
    render(React.createElement(EvidenceGallery, {}))
    await flush()

    const nextBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Next') as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)
  })

  it('renders a distinct real type badge per evidence type', async () => {
    const items = [makeEvidence({ id: 'a', type: 'build' }), makeEvidence({ id: 'b', type: 'deployment' })]
    global.fetch = vi.fn(() => jsonResponse({ evidence: items, pagination: { total: 2, limit: 20, offset: 0, hasMore: false } })) as any
    render(React.createElement(EvidenceGallery, {}))
    await flush()

    expect(host.textContent).toContain('build')
    expect(host.textContent).toContain('deployment')
  })

  it('a real failed fetch never crashes the component — stays in a safe, non-loading state', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down'))) as any
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(React.createElement(EvidenceGallery, {}))
    await flush()

    expect(host.textContent).not.toContain('Loading evidence...')
    consoleSpy.mockRestore()
  })
})
