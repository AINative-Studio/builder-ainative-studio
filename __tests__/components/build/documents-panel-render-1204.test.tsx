// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { DocumentsPanel } from '@/components/build/DocumentsPanel'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — DocumentsPanel (components/build/DocumentsPanel.tsx,
 * 475 lines, reached live via components/build/screens/Live.tsx) had zero
 * test coverage.
 */

function jsonResponse(data: any, ok = true, status = ok ? 200 : 500) {
  return Promise.resolve({ ok, status, json: async () => data } as Response)
}

function makeDoc(overrides: Partial<{ id: string; kind: 'document' | 'report'; type: string; typeLabel: string; title: string; createdAt: string }> = {}) {
  return {
    id: 'doc-1', kind: 'document' as const, type: 'research', typeLabel: 'Research',
    title: 'Market Research', createdAt: new Date().toISOString(), ...overrides,
  }
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
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('DocumentsPanel — real tabs/view/generate/upload/export coverage (#1204)', () => {
  it('shows the real loading state, then the real honest empty state with no fabricated entries', async () => {
    global.fetch = vi.fn(() => jsonResponse({ documents: [], counts: { all: 0, document: 0, report: 0 } })) as any
    render(React.createElement(DocumentsPanel, { companyId: 'co-1', companyName: 'Acme' }))

    expect(host.querySelector('[data-testid="documents-loading"]')).not.toBeNull()
    await flush()

    expect(host.querySelector('[data-testid="documents-empty"]')).not.toBeNull()
    expect(host.textContent).toContain('No documents yet')
    expect(host.textContent).toContain('Acme')
  })

  it('renders real document cards with their real kind badge, type, title and date', async () => {
    const docs = [
      makeDoc({ id: 'd1', kind: 'document', typeLabel: 'Research', title: 'Market Research' }),
      makeDoc({ id: 'd2', kind: 'report', type: 'nightly', typeLabel: 'Nightly Report', title: 'Oct 23 report' }),
    ]
    global.fetch = vi.fn(() => jsonResponse({ documents: docs, counts: { all: 2, document: 1, report: 1 } })) as any
    render(React.createElement(DocumentsPanel, { companyId: 'co-1' }))
    await flush()

    const cards = Array.from(host.querySelectorAll('[data-testid="document-card"]'))
    expect(cards).toHaveLength(2)
    expect(cards[0].querySelector('[data-testid="document-kind-badge"]')?.textContent).toBe('DOC')
    expect(cards[0].querySelector('[data-testid="document-title"]')?.textContent).toBe('Market Research')
    expect(cards[1].querySelector('[data-testid="document-kind-badge"]')?.textContent).toBe('REPORT')
  })

  it('the real Documents/Reports tabs filter the real list and show the real counts', async () => {
    const docs = [makeDoc({ id: 'd1', kind: 'document' }), makeDoc({ id: 'd2', kind: 'report', type: 'nightly', typeLabel: 'Nightly' })]
    global.fetch = vi.fn(() => jsonResponse({ documents: docs, counts: { all: 2, document: 1, report: 1 } })) as any
    render(React.createElement(DocumentsPanel, { companyId: 'co-1' }))
    await flush()

    expect(host.querySelector('[data-testid="documents-tab-document"]')?.textContent).toContain('1')
    expect(host.querySelector('[data-testid="documents-tab-report"]')?.textContent).toContain('1')

    const reportTab = host.querySelector('[data-testid="documents-tab-report"]') as HTMLButtonElement
    await act(async () => { reportTab.click() })

    expect(host.querySelectorAll('[data-testid="document-card"]')).toHaveLength(1)
    expect(host.querySelector('[data-testid="document-card"]')?.getAttribute('data-kind')).toBe('report')
  })

  it('shows the real "Generate X" CTAs only for starter types genuinely not yet present, and only when a real idea is given', async () => {
    const docs = [makeDoc({ id: 'd1', type: 'research', typeLabel: 'Research' })]
    global.fetch = vi.fn(() => jsonResponse({ documents: docs, counts: { all: 1, document: 1, report: 0 } })) as any
    render(React.createElement(DocumentsPanel, { companyId: 'co-1', idea: 'A coffee app' }))
    await flush()

    expect(host.querySelector('[data-testid="documents-generate-research"]')).toBeNull()
    expect(host.querySelector('[data-testid="documents-generate-roadmap"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="documents-generate-mission"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="documents-generate-market"]')).not.toBeNull()
  })

  it('never shows a Generate CTA when there is genuinely no idea, even with missing starters', async () => {
    global.fetch = vi.fn(() => jsonResponse({ documents: [], counts: { all: 0, document: 0, report: 0 } })) as any
    render(React.createElement(DocumentsPanel, { companyId: 'co-1' }))
    await flush()

    expect(host.querySelector('[data-testid="documents-generate-cta"]')).toBeNull()
  })

  it('clicking Generate POSTs the real idea/companyName/track and reloads the real library', async () => {
    let generated = false
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url)
      if (u === '/api/build/documents' && init?.method === 'POST') {
        generated = true
        return jsonResponse({ document: makeDoc({ id: 'new-doc', type: 'roadmap', typeLabel: 'Product Roadmap', title: 'Roadmap' }) })
      }
      return jsonResponse({ documents: generated ? [makeDoc({ id: 'new-doc', type: 'roadmap', typeLabel: 'Product Roadmap', title: 'Roadmap' })] : [], counts: { all: generated ? 1 : 0, document: generated ? 1 : 0, report: 0 } })
    }) as any

    render(React.createElement(DocumentsPanel, { companyId: 'co-1', idea: 'A coffee app', companyName: 'Acme', track: 'app' }))
    await flush()

    const genBtn = host.querySelector('[data-testid="documents-generate-roadmap"]') as HTMLButtonElement
    await act(async () => { genBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/build/documents', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ companyId: 'co-1', generate: true, type: 'roadmap', idea: 'A coffee app', companyName: 'Acme', track: 'app' }),
    }))
    expect(host.textContent).toContain('Roadmap')
  })

  it('shows the real "generation unavailable" message distinctly from a generic generate error', async () => {
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === '/api/build/documents' && init?.method === 'POST') {
        return jsonResponse({ error: 'generation_unavailable' }, false)
      }
      return jsonResponse({ documents: [], counts: { all: 0, document: 0, report: 0 } })
    }) as any
    render(React.createElement(DocumentsPanel, { companyId: 'co-1', idea: 'A coffee app' }))
    await flush()

    const genBtn = host.querySelector('[data-testid="documents-generate-research"]') as HTMLButtonElement
    await act(async () => { genBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="documents-gen-error"]')?.textContent).toBe('Generation is unavailable right now — try again shortly.')
  })

  it('VIEW loads the real full document content and renders it via react-markdown', async () => {
    const summary = makeDoc({ id: 'd1' })
    const full = { ...summary, content: '# Heading\n\nSome **bold** text.' }
    global.fetch = vi.fn((url: string) => {
      const u = String(url)
      if (u.includes('&id=d1')) return jsonResponse({ document: full })
      return jsonResponse({ documents: [summary], counts: { all: 1, document: 1, report: 0 } })
    }) as any
    render(React.createElement(DocumentsPanel, { companyId: 'co-1' }))
    await flush()

    const viewBtn = host.querySelector('[data-testid="document-view"]') as HTMLButtonElement
    await act(async () => { viewBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="document-detail"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="document-content"] h1')?.textContent).toBe('Heading')
    expect(host.querySelector('[data-testid="document-content"] strong')?.textContent).toBe('bold')
  })

  it('a real 404 on VIEW shows the real "could not be found" error, never a silent no-op', async () => {
    const summary = makeDoc({ id: 'd1' })
    global.fetch = vi.fn((url: string) => {
      const u = String(url)
      if (u.includes('&id=d1')) return jsonResponse({}, false, 404)
      return jsonResponse({ documents: [summary], counts: { all: 1, document: 1, report: 0 } })
    }) as any
    render(React.createElement(DocumentsPanel, { companyId: 'co-1' }))
    await flush()

    const viewBtn = host.querySelector('[data-testid="document-view"]') as HTMLButtonElement
    await act(async () => { viewBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="document-detail"]')).toBeNull()
    expect(host.querySelector('[data-testid="document-view-error"]')?.textContent).toContain('could not be found')
  })

  it('dismissing the VIEW error clears it', async () => {
    const summary = makeDoc({ id: 'd1' })
    global.fetch = vi.fn((url: string) => {
      const u = String(url)
      if (u.includes('&id=d1')) return jsonResponse({}, false, 404)
      return jsonResponse({ documents: [summary], counts: { all: 1, document: 1, report: 0 } })
    }) as any
    render(React.createElement(DocumentsPanel, { companyId: 'co-1' }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="document-view"]') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve() })
    const dismissBtn = host.querySelector('[data-testid="document-view-error-dismiss"]') as HTMLButtonElement
    await act(async () => { dismissBtn.click() })

    expect(host.querySelector('[data-testid="document-view-error"]')).toBeNull()
  })

  it('closing the VIEW dialog clears the viewing document', async () => {
    const summary = makeDoc({ id: 'd1' })
    const full = { ...summary, content: 'body' }
    global.fetch = vi.fn((url: string) => {
      const u = String(url)
      if (u.includes('&id=d1')) return jsonResponse({ document: full })
      return jsonResponse({ documents: [summary], counts: { all: 1, document: 1, report: 0 } })
    }) as any
    render(React.createElement(DocumentsPanel, { companyId: 'co-1' }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="document-view"]') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve() })
    expect(host.querySelector('[data-testid="document-detail"]')).not.toBeNull()

    await act(async () => { (host.querySelector('[data-testid="document-detail-close"]') as HTMLButtonElement).click() })
    expect(host.querySelector('[data-testid="document-detail"]')).toBeNull()
  })

  it('uploading a real file POSTs the real FormData and reloads the library', async () => {
    const file = new File(['content'], 'notes.pdf', { type: 'application/pdf' })
    let uploaded = false
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url)
      if (u === '/api/build/documents/upload' && init?.method === 'POST') {
        uploaded = true
        expect(init.body).toBeInstanceOf(FormData)
        return jsonResponse({ ok: true })
      }
      return jsonResponse({ documents: uploaded ? [makeDoc({ id: 'uploaded' })] : [], counts: { all: uploaded ? 1 : 0, document: uploaded ? 1 : 0, report: 0 } })
    }) as any
    render(React.createElement(DocumentsPanel, { companyId: 'co-1' }))
    await flush()

    const input = host.querySelector('[data-testid="document-upload-input"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/build/documents/upload', expect.objectContaining({ method: 'POST' }))
    expect(host.querySelectorAll('[data-testid="document-card"]')).toHaveLength(1)
  })

  it('shows the real upload error message on a genuine upload failure', async () => {
    const file = new File(['x'], 'bad.exe', { type: 'application/x-msdownload' })
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === '/api/build/documents/upload' && init?.method === 'POST') {
        return jsonResponse({ message: 'That file type is not supported.' }, false)
      }
      return jsonResponse({ documents: [], counts: { all: 0, document: 0, report: 0 } })
    }) as any
    render(React.createElement(DocumentsPanel, { companyId: 'co-1' }))
    await flush()

    const input = host.querySelector('[data-testid="document-upload-input"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="document-upload-error"]')?.textContent).toBe('That file type is not supported.')
  })

  it('shows the real "paid" locked label and calls onExportUpgrade without ever POSTing the deck when not paid', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ documents: [], counts: { all: 0, document: 0, report: 0 } }))
    global.fetch = fetchMock as any
    const onExportUpgrade = vi.fn()
    render(React.createElement(DocumentsPanel, { companyId: 'co-1', canExportDeck: false, onExportUpgrade }))
    await flush()

    expect(host.querySelector('[data-testid="deck-export-locked"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="deck-export-btn"]')?.textContent).toBe('Export pitch deck (paid)')

    await act(async () => { (host.querySelector('[data-testid="deck-export-btn"]') as HTMLButtonElement).click() })

    expect(onExportUpgrade).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/build/deck', expect.anything())
  })

  it('a real paid export success triggers a real anchor-click download with the real filename', async () => {
    const blob = new Blob(['pptx-bytes'])
    global.fetch = vi.fn((url: string) => {
      if (String(url) === '/api/build/deck') {
        return Promise.resolve({
          ok: true, status: 200,
          headers: new Headers({ 'Content-Disposition': 'attachment; filename="acme-deck.pptx"' }),
          blob: async () => blob,
        } as unknown as Response)
      }
      return jsonResponse({ documents: [], counts: { all: 0, document: 0, report: 0 } })
    }) as any
    global.URL.createObjectURL = vi.fn(() => 'blob:fake') as any
    global.URL.revokeObjectURL = vi.fn() as any
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(React.createElement(DocumentsPanel, { companyId: 'co-1', canExportDeck: true, brandTagline: 'Great coffee', brandColor: '#ff0000' }))
    await flush()

    const exportBtn = host.querySelector('[data-testid="deck-export-btn"]') as HTMLButtonElement
    await act(async () => { exportBtn.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/build/deck', expect.objectContaining({
      method: 'POST', body: expect.stringContaining('"tagline":"Great coffee"'),
    }))
    expect(clickSpy).toHaveBeenCalled()
    expect(host.querySelector('[data-testid="deck-export-error"]')).toBeNull()
  })

  it('a real 402 from the server shows the real paid-deliverable message AND calls onExportUpgrade even when canExportDeck was true client-side', async () => {
    global.fetch = vi.fn((url: string) => {
      if (String(url) === '/api/build/deck') return jsonResponse({}, false, 402)
      return jsonResponse({ documents: [], counts: { all: 0, document: 0, report: 0 } })
    }) as any
    const onExportUpgrade = vi.fn()
    render(React.createElement(DocumentsPanel, { companyId: 'co-1', canExportDeck: true, onExportUpgrade }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="deck-export-btn"]') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="deck-export-error"]')?.textContent).toBe('Pitch-deck export is a paid deliverable.')
    expect(onExportUpgrade).toHaveBeenCalled()
  })
})
