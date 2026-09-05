// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { DocumentsPanel } from '@/components/build/DocumentsPanel'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #64 — real jsdom render tests for the VIEW action's failure handling.
 *
 * Real bug report: clicking "View →" on a report did nothing — no dialog, no
 * error, nothing visible at all. Root cause confirmed in the code: the old
 * `view()` handler only ever set `viewing` on a SUCCESSFUL response
 * (`res.ok && d?.document`); every failure path (404, malformed body, network
 * error) silently left `viewing` null with no feedback whatsoever. From the
 * founder's side that is indistinguishable from "the button does nothing."
 * The fix makes every failure path set a real, visible error message.
 */

let host: HTMLElement
let root: Root

function render(el: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(el))
}

function unmount() {
  act(() => root.unmount())
  host.remove()
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const SUMMARY_LIST = {
  documents: [
    { id: 'rep-1', kind: 'report', type: 'daily', typeLabel: 'Daily Report', title: 'Daily Operational Report — Sep 5, 2026', createdAt: '2026-09-05T07:00:00Z' },
  ],
  counts: { all: 1, document: 0, report: 1 },
  kinds: [{ kind: 'all', label: 'All' }, { kind: 'document', label: 'Documents' }, { kind: 'report', label: 'Reports' }],
}

describe('DocumentsPanel — VIEW failure handling (real bug: "View does nothing")', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  it('shows a real, visible error when the document fetch 404s (was: silent no-op)', async () => {
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('id=')) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) } as any
      return { ok: true, json: async () => SUMMARY_LIST } as any
    })
    render(<DocumentsPanel companyId="beacon" idea="an idea" companyName="Beacon" track="app" />)
    await flush()

    const viewBtn = host.querySelector('[data-testid="document-view"]') as HTMLButtonElement
    expect(viewBtn).toBeTruthy()
    act(() => { viewBtn.click() })
    await flush()

    const error = host.querySelector('[data-testid="document-view-error"]')
    expect(error).toBeTruthy()
    expect(error!.textContent).toMatch(/could not be found/i)
    // No dialog should be stuck open in a broken/empty state.
    expect(host.querySelector('[data-testid="document-detail"]')).toBeNull()
  })

  it('shows a real error when the response is ok but carries no document (malformed body)', async () => {
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('id=')) return { ok: true, json: async () => ({}) } as any
      return { ok: true, json: async () => SUMMARY_LIST } as any
    })
    render(<DocumentsPanel companyId="beacon" idea="an idea" companyName="Beacon" track="app" />)
    await flush()
    const viewBtn = host.querySelector('[data-testid="document-view"]') as HTMLButtonElement
    act(() => { viewBtn.click() })
    await flush()
    expect(host.querySelector('[data-testid="document-view-error"]')).toBeTruthy()
  })

  it('shows a real error on a network failure', async () => {
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('id=')) throw new Error('network down')
      return { ok: true, json: async () => SUMMARY_LIST } as any
    })
    render(<DocumentsPanel companyId="beacon" idea="an idea" companyName="Beacon" track="app" />)
    await flush()
    const viewBtn = host.querySelector('[data-testid="document-view"]') as HTMLButtonElement
    act(() => { viewBtn.click() })
    await flush()
    const error = host.querySelector('[data-testid="document-view-error"]')
    expect(error).toBeTruthy()
    expect(error!.textContent).toMatch(/connection hiccup/i)
  })

  it('a successful VIEW still renders the document content and clears any stale error', async () => {
    const FULL = { ...SUMMARY_LIST.documents[0], content: '## Executive Summary\nx\n## Key Findings\n- y\n## Sources\n- z' }
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('id=')) return { ok: true, json: async () => ({ document: FULL }) } as any
      return { ok: true, json: async () => SUMMARY_LIST } as any
    })
    render(<DocumentsPanel companyId="beacon" idea="an idea" companyName="Beacon" track="app" />)
    await flush()
    const viewBtn = host.querySelector('[data-testid="document-view"]') as HTMLButtonElement
    act(() => { viewBtn.click() })
    await flush()
    expect(host.querySelector('[data-testid="document-view-error"]')).toBeNull()
    expect(host.querySelector('[data-testid="document-detail"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="document-content"]')?.textContent).toMatch(/Executive Summary/)
  })

  it('the error can be dismissed', async () => {
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('id=')) return { ok: false, status: 404, json: async () => ({}) } as any
      return { ok: true, json: async () => SUMMARY_LIST } as any
    })
    render(<DocumentsPanel companyId="beacon" idea="an idea" companyName="Beacon" track="app" />)
    await flush()
    const viewBtn = host.querySelector('[data-testid="document-view"]') as HTMLButtonElement
    act(() => { viewBtn.click() })
    await flush()
    expect(host.querySelector('[data-testid="document-view-error"]')).toBeTruthy()
    const dismiss = host.querySelector('[data-testid="document-view-error-dismiss"]') as HTMLButtonElement
    act(() => { dismiss.click() })
    await flush()
    expect(host.querySelector('[data-testid="document-view-error"]')).toBeNull()
  })
})
