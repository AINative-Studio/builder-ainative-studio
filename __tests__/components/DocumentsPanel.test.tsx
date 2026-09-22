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

/**
 * #820 — the empty-state "generate starter docs" action is a real, working
 * capability but used to read as a purely passive `<p>` with a `btn-secondary`
 * button group identical in weight to unrelated actions (Export pitch deck,
 * Upload a document). It should now carry real visual priority: `btn-primary`
 * buttons plus a short "Cody can build these for you" framing line, and
 * clicking one must still fire the real generate() request.
 */
describe('DocumentsPanel — empty-state starter-doc CTA is visually prioritized (#820)', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  const EMPTY_LIST = {
    documents: [],
    counts: { all: 0, document: 0, report: 0 },
    kinds: [{ kind: 'all', label: 'All' }, { kind: 'document', label: 'Documents' }, { kind: 'report', label: 'Reports' }],
  }

  it('renders the starter-doc buttons as btn-primary with a framing hint above them when empty', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => EMPTY_LIST } as any))
    render(<DocumentsPanel companyId="beacon" idea="an idea" companyName="Beacon" track="app" />)
    await flush()

    const hint = host.querySelector('[data-testid="documents-generate-hint"]')
    expect(hint).toBeTruthy()
    expect(hint!.textContent).toMatch(/cody can build these for you/i)

    const group = host.querySelector('[data-testid="documents-generate"]')
    expect(group).toBeTruthy()
    const buttons = group!.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(0)
    buttons.forEach((b) => {
      expect(b.className).toContain('btn-primary')
      expect(b.className).not.toContain('btn-secondary')
    })
  })

  it('clicking a primary starter-doc button still fires the real generate() request', async () => {
    let generatePosted: any = null
    global.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url)
      if (init?.method === 'POST') {
        generatePosted = JSON.parse(init.body)
        return { ok: true, json: async () => ({ document: { id: 'd1', kind: 'document', type: 'research', typeLabel: 'Research', title: 'Research', createdAt: new Date().toISOString() } }) } as any
      }
      return { ok: true, json: async () => EMPTY_LIST } as any
    })
    render(<DocumentsPanel companyId="beacon" idea="an idea" companyName="Beacon" track="app" />)
    await flush()

    const btn = host.querySelector('[data-testid="documents-generate-research"]') as HTMLButtonElement
    expect(btn).toBeTruthy()
    act(() => { btn.click() })
    await flush()

    expect(generatePosted).toMatchObject({ companyId: 'beacon', generate: true, type: 'research', idea: 'an idea', companyName: 'Beacon', track: 'app' })
  })

  it('the Export pitch deck and Upload document actions remain btn-secondary (no regression)', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => EMPTY_LIST } as any))
    render(<DocumentsPanel companyId="beacon" idea="an idea" companyName="Beacon" track="app" />)
    await flush()

    const deckBtn = host.querySelector('[data-testid="deck-export-btn"]') as HTMLButtonElement
    const uploadBtn = host.querySelector('[data-testid="document-upload-btn"]') as HTMLButtonElement
    expect(deckBtn.className).toContain('btn-secondary')
    expect(uploadBtn.className).toContain('btn-secondary')
  })
})
