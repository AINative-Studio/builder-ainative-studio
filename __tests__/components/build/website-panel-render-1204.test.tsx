// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { WebsitePanel } from '@/components/build/WebsitePanel'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — WebsitePanel (components/build/WebsitePanel.tsx,
 * 561 lines, reached live via components/build/screens/Live.tsx) had only
 * narrow, bug-investigation-scoped coverage (WebsitePanel-logo.test.tsx:
 * logo upload only; WebsitePanel-secrets-reason.test.tsx: the secrets-
 * unavailable reason text only). This file covers the remaining real
 * surface: the redeploy lifecycle, secrets add/delete/locked/empty states,
 * and both export flows (data JSON/CSV + #1187 code ZIP) — none of which
 * had any test.
 */

function jsonResponse(data: any, ok = true, status = ok ? 200 : 500) {
  return Promise.resolve({ ok, status, json: async () => data } as Response)
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

function defaultFetch(url: string) {
  const u = String(url)
  if (u.startsWith('/api/build/logo')) return jsonResponse({ url: null })
  if (u.startsWith('/api/build/secrets')) return jsonResponse({ secrets: [], available: true })
  return jsonResponse({})
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('WebsitePanel — real redeploy/secrets/export coverage (#1204)', () => {
  it('a Redeploy click shows the real confirm dialog before anything is triggered', async () => {
    global.fetch = vi.fn(defaultFetch) as any
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: true }))
    await flush()

    const redeployBtn = host.querySelector('[data-testid="redeploy-btn"]') as HTMLButtonElement
    await act(async () => { redeployBtn.click() })

    expect(host.querySelector('[data-testid="redeploy-confirm"]')).not.toBeNull()
  })

  it('Cancel on the confirm dialog returns to idle without ever POSTing redeploy', async () => {
    const fetchMock = vi.fn(defaultFetch)
    global.fetch = fetchMock as any
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: true }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="redeploy-btn"]') as HTMLButtonElement).click() })
    await act(async () => { (host.querySelector('[data-testid="redeploy-cancel-btn"]') as HTMLButtonElement).click() })

    expect(host.querySelector('[data-testid="redeploy-confirm"]')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/build/redeploy', expect.anything())
  })

  it('confirming redeploy POSTs the real companyId and shows the real "live" status when status/healthy both report so', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === '/api/build/redeploy' && init?.method === 'POST') {
        return jsonResponse({ ok: true, status: 'live', healthy: true })
      }
      return defaultFetch(url)
    })
    global.fetch = fetchMock as any
    render(React.createElement(WebsitePanel, { companyId: 'co-xyz', canManage: true }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="redeploy-btn"]') as HTMLButtonElement).click() })
    await act(async () => { (host.querySelector('[data-testid="redeploy-confirm-btn"]') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve() })

    expect(fetchMock).toHaveBeenCalledWith('/api/build/redeploy', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ companyId: 'co-xyz' }),
    }))
    expect(host.querySelector('[data-testid="redeploy-status"]')?.textContent).toBe('✓ Redeployed — your site is live.')
  })

  it('shows the real "validating" status when accepted but genuinely not yet healthy', async () => {
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === '/api/build/redeploy' && init?.method === 'POST') {
        return jsonResponse({ ok: true, status: 'deploying', healthy: false })
      }
      return defaultFetch(url)
    }) as any
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: true }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="redeploy-btn"]') as HTMLButtonElement).click() })
    await act(async () => { (host.querySelector('[data-testid="redeploy-confirm-btn"]') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="redeploy-status"]')?.textContent).toBe('Validating your live site…')
  })

  it('shows the real error status + message when the redeploy request genuinely fails', async () => {
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === '/api/build/redeploy' && init?.method === 'POST') {
        return jsonResponse({ ok: false, error: 'Deploy service unavailable' }, false)
      }
      return defaultFetch(url)
    }) as any
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: true }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="redeploy-btn"]') as HTMLButtonElement).click() })
    await act(async () => { (host.querySelector('[data-testid="redeploy-confirm-btn"]') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="redeploy-status"]')?.textContent).toBe('Deploy service unavailable')
  })

  it('a locked (non-owner/unpaid) founder sees Redeploy call onRequireUpgrade instead of confirming', async () => {
    global.fetch = vi.fn(defaultFetch) as any
    const onRequireUpgrade = vi.fn()
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: false, onRequireUpgrade }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="redeploy-btn"]') as HTMLButtonElement).click() })

    expect(onRequireUpgrade).toHaveBeenCalled()
    expect(host.querySelector('[data-testid="redeploy-confirm"]')).toBeNull()
  })

  it('shows the real "Upgrade to add runtime secrets" CTA when locked, and never fetches secrets', async () => {
    const fetchMock = vi.fn(defaultFetch)
    global.fetch = fetchMock as any
    const onRequireUpgrade = vi.fn()
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: false, onRequireUpgrade }))
    await flush()

    const lockedBtn = host.querySelector('[data-testid="secrets-locked"]') as HTMLButtonElement
    expect(lockedBtn.textContent).toContain('Upgrade to add runtime secrets')
    await act(async () => { lockedBtn.click() })
    expect(onRequireUpgrade).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/build/secrets'), expect.anything())
  })

  it('shows the real empty-secrets state when genuinely available with zero secrets', async () => {
    global.fetch = vi.fn((url: string) => {
      if (String(url).startsWith('/api/build/secrets')) return jsonResponse({ secrets: [], available: true })
      return defaultFetch(url)
    }) as any
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: true }))
    await flush()

    expect(host.querySelector('[data-testid="secrets-empty"]')).not.toBeNull()
  })

  it('renders real secret rows with masked values, and a reserved secret has no delete button', async () => {
    global.fetch = vi.fn((url: string) => {
      if (String(url).startsWith('/api/build/secrets')) {
        return jsonResponse({
          secrets: [
            { name: 'API_KEY', masked: 'sk-****1234', reserved: false },
            { name: 'DATABASE_URL', masked: '••••••••', reserved: true },
          ],
          available: true,
        })
      }
      return defaultFetch(url)
    }) as any
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: true }))
    await flush()

    const rows = Array.from(host.querySelectorAll('[data-testid="secret-row"]'))
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('API_KEY')
    expect(rows[0].textContent).toContain('sk-****1234')
    expect(rows[0].querySelector('[data-testid="secret-delete"]')).not.toBeNull()
    expect(rows[1].textContent).toContain('DATABASE_URL')
    expect(rows[1].querySelector('[data-testid="secret-reserved"]')).not.toBeNull()
    expect(rows[1].querySelector('[data-testid="secret-delete"]')).toBeNull()
  })

  it('adding a secret POSTs the real name/value and reloads the real secrets list', async () => {
    let addCount = 0
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.startsWith('/api/build/secrets') && init?.method === 'POST') {
        addCount++
        return jsonResponse({ ok: true })
      }
      if (u.startsWith('/api/build/secrets')) {
        return jsonResponse({ secrets: addCount > 0 ? [{ name: 'NEW_KEY', masked: '****', reserved: false }] : [], available: true })
      }
      return defaultFetch(url)
    }) as any
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: true }))
    await flush()

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    const nameInput = host.querySelector('[data-testid="secret-name-input"]') as HTMLInputElement
    const valueInput = host.querySelector('[data-testid="secret-value-input"]') as HTMLInputElement
    await act(async () => { setter.call(nameInput, 'NEW_KEY'); nameInput.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { setter.call(valueInput, 'secret123'); valueInput.dispatchEvent(new Event('input', { bubbles: true })) })

    const saveBtn = host.querySelector('[data-testid="secret-save"]') as HTMLButtonElement
    await act(async () => { saveBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/build/secrets', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ companyId: 'co-1', name: 'NEW_KEY', value: 'secret123' }),
    }))
    expect(host.querySelector('[data-testid="secrets-list"]')?.textContent).toContain('NEW_KEY')
  })

  it('Save stays disabled with a genuinely empty secret name', async () => {
    global.fetch = vi.fn(defaultFetch) as any
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: true }))
    await flush()

    expect((host.querySelector('[data-testid="secret-save"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('deleting a secret DELETEs the real name and reloads the list', async () => {
    let deleted = false
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.startsWith('/api/build/secrets') && init?.method === 'DELETE') {
        deleted = true
        return jsonResponse({ ok: true })
      }
      if (u.startsWith('/api/build/secrets')) {
        return jsonResponse({ secrets: deleted ? [] : [{ name: 'OLD_KEY', masked: '****', reserved: false }], available: true })
      }
      return defaultFetch(url)
    }) as any
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: true }))
    await flush()

    const deleteBtn = host.querySelector('[data-testid="secret-delete"]') as HTMLButtonElement
    await act(async () => { deleteBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/build/secrets', expect.objectContaining({
      method: 'DELETE', body: JSON.stringify({ companyId: 'co-1', name: 'OLD_KEY' }),
    }))
    expect(host.querySelector('[data-testid="secrets-empty"]')).not.toBeNull()
  })

  it('a real JSON export success triggers a real browser download via an anchor click, with the filename from Content-Disposition', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' })
    global.fetch = vi.fn((url: string) => {
      if (String(url).startsWith('/api/build/export?')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'Content-Disposition': 'attachment; filename="acme-data.json"' }),
          blob: async () => blob,
        } as unknown as Response)
      }
      return defaultFetch(url)
    }) as any
    const createObjectURL = vi.fn(() => 'blob:fake-url')
    const revokeObjectURL = vi.fn()
    global.URL.createObjectURL = createObjectURL as any
    global.URL.revokeObjectURL = revokeObjectURL as any
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: true }))
    await flush()

    const jsonBtn = host.querySelector('[data-testid="export-json"]') as HTMLButtonElement
    await act(async () => { jsonBtn.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
  })

  it('shows the real export error message when the JSON export request genuinely fails', async () => {
    global.fetch = vi.fn((url: string) => {
      if (String(url).startsWith('/api/build/export?')) return jsonResponse({ error: 'Export quota exceeded' }, false)
      return defaultFetch(url)
    }) as any
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: true }))
    await flush()

    const csvBtn = host.querySelector('[data-testid="export-csv"]') as HTMLButtonElement
    await act(async () => { csvBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="export-error"]')?.textContent).toBe('Export quota exceeded')
  })

  it('a locked founder clicking Download JSON calls onRequireUpgrade and never fetches export', async () => {
    const fetchMock = vi.fn(defaultFetch)
    global.fetch = fetchMock as any
    const onRequireUpgrade = vi.fn()
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: false, onRequireUpgrade }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="export-json"]') as HTMLButtonElement).click() })

    expect(onRequireUpgrade).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/build/export?'), expect.anything())
  })

  it('a real project-code ZIP export success triggers a real download with the real source filename', async () => {
    const blob = new Blob(['zip-bytes'], { type: 'application/zip' })
    global.fetch = vi.fn((url: string) => {
      if (String(url).startsWith('/api/build/export-code?')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'Content-Disposition': 'attachment; filename="acme-source.zip"' }),
          blob: async () => blob,
        } as unknown as Response)
      }
      return defaultFetch(url)
    }) as any
    global.URL.createObjectURL = vi.fn(() => 'blob:fake-url') as any
    global.URL.revokeObjectURL = vi.fn() as any
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: true }))
    await flush()

    const codeBtn = host.querySelector('[data-testid="export-code"]') as HTMLButtonElement
    await act(async () => { codeBtn.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(clickSpy).toHaveBeenCalled()
    expect(host.querySelector('[data-testid="export-code-error"]')).toBeNull()
  })

  it('shows the real export-code error message when the code export request genuinely fails', async () => {
    global.fetch = vi.fn((url: string) => {
      if (String(url).startsWith('/api/build/export-code?')) return jsonResponse({ error: 'Source build not ready' }, false)
      return defaultFetch(url)
    }) as any
    render(React.createElement(WebsitePanel, { companyId: 'co-1', canManage: true }))
    await flush()

    const codeBtn = host.querySelector('[data-testid="export-code"]') as HTMLButtonElement
    await act(async () => { codeBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="export-code-error"]')?.textContent).toBe('Source build not ready')
  })
})
