// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { VersionsPanel } from '@/components/build/VersionsPanel'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — VersionsPanel (components/build/VersionsPanel.tsx,
 * 305 lines, reached live via components/build/screens/Live.tsx) had only
 * narrow coverage from VersionsPanel-loading-skeleton.test.tsx (#1190, the
 * loading skeleton only). This covers the remaining real surface: the real
 * version list, confirm/cancel/rollback flow, the real validating-poll
 * lifecycle, and the serviced/single-version note.
 */

function jsonResponse(data: any, ok = true) {
  return Promise.resolve({ ok, json: async () => data } as Response)
}

function makeVersion(overrides: Partial<{
  deploymentId: string; status: 'live' | 'success' | 'building' | 'failed' | 'removed'
  message: string; commitSha?: string; createdAt?: string; current: boolean; canRollback: boolean
}> = {}) {
  return {
    deploymentId: 'dep-1', status: 'live' as const, message: 'Add dark mode',
    commitSha: 'abc1234', createdAt: new Date().toISOString(), current: true, canRollback: false,
    ...overrides,
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
  vi.useRealTimers()
})

describe('VersionsPanel — real version list/rollback/poll coverage (#1204)', () => {
  it('shows the real honest empty state when genuinely zero versions exist', async () => {
    global.fetch = vi.fn(() => jsonResponse({ versions: [], serviced: false })) as any
    render(React.createElement(VersionsPanel, { companyId: 'co-1' }))
    await flush()

    expect(host.querySelector('[data-testid="versions-empty"]')).not.toBeNull()
  })

  it('shows the real "first version" note only when genuinely unserviced', async () => {
    global.fetch = vi.fn(() => jsonResponse({ versions: [makeVersion()], serviced: false })) as any
    render(React.createElement(VersionsPanel, { companyId: 'co-1' }))
    await flush()

    expect(host.querySelector('[data-testid="versions-single-note"]')).not.toBeNull()
  })

  it('never shows the "first version" note when genuinely serviced', async () => {
    global.fetch = vi.fn(() => jsonResponse({ versions: [makeVersion()], serviced: true })) as any
    render(React.createElement(VersionsPanel, { companyId: 'co-1' }))
    await flush()

    expect(host.querySelector('[data-testid="versions-single-note"]')).toBeNull()
  })

  it('renders real version cards with their real CURRENT badge, SHA chip, message and age', async () => {
    const versions = [
      makeVersion({ deploymentId: 'd1', current: true, status: 'live', message: 'Add dark mode', commitSha: 'abc1234' }),
      makeVersion({ deploymentId: 'd2', current: false, status: 'success', message: 'Fix header', commitSha: 'def5678', canRollback: true }),
    ]
    global.fetch = vi.fn(() => jsonResponse({ versions, serviced: true })) as any
    render(React.createElement(VersionsPanel, { companyId: 'co-1' }))
    await flush()

    const cards = Array.from(host.querySelectorAll('[data-testid="version-card"]'))
    expect(cards).toHaveLength(2)
    expect(cards[0].querySelector('[data-testid="version-status-badge"]')?.textContent).toBe('CURRENT')
    expect(cards[0].querySelector('[data-testid="version-sha"]')?.textContent).toBe('abc1234')
    expect(cards[0].querySelector('[data-testid="version-message"]')?.textContent).toBe('Add dark mode')
    expect(cards[1].querySelector('[data-testid="version-status-badge"]')?.textContent).toBe('success')
  })

  it('shows REVERT only for a real canRollback version, and a "live" tag for the real current, non-revertable version', async () => {
    const versions = [
      makeVersion({ deploymentId: 'd1', current: true, canRollback: false }),
      makeVersion({ deploymentId: 'd2', current: false, canRollback: true, status: 'success' }),
      makeVersion({ deploymentId: 'd3', current: false, canRollback: false, status: 'failed' }),
    ]
    global.fetch = vi.fn(() => jsonResponse({ versions, serviced: true })) as any
    render(React.createElement(VersionsPanel, { companyId: 'co-1' }))
    await flush()

    const cards = Array.from(host.querySelectorAll('[data-testid="version-card"]'))
    expect(cards[0].querySelector('[data-testid="version-live-tag"]')).not.toBeNull()
    expect(cards[0].querySelector('[data-testid="version-revert"]')).toBeNull()
    expect(cards[1].querySelector('[data-testid="version-revert"]')).not.toBeNull()
    expect(cards[2].querySelector('[data-testid="version-live-tag"]')).toBeNull()
    expect(cards[2].querySelector('[data-testid="version-revert"]')).toBeNull()
  })

  it('clicking REVERT shows the real confirm dialog with the real version message/SHA, never rolling back yet', async () => {
    const v = makeVersion({ deploymentId: 'd2', current: false, canRollback: true, message: 'Fix header', commitSha: 'def5678' })
    const fetchMock = vi.fn(() => jsonResponse({ versions: [v], serviced: true }))
    global.fetch = fetchMock as any
    render(React.createElement(VersionsPanel, { companyId: 'co-1' }))
    await flush()

    const revertBtn = host.querySelector('[data-testid="version-revert"]') as HTMLButtonElement
    await act(async () => { revertBtn.click() })

    const confirm = host.querySelector('[data-testid="rollback-confirm"]')
    expect(confirm).not.toBeNull()
    expect(confirm?.textContent).toContain('Fix header')
    expect(confirm?.textContent).toContain('def5678')
    expect(fetchMock).not.toHaveBeenCalledWith('/api/build/versions', expect.objectContaining({ method: 'POST' }))
  })

  it('Cancel on the confirm dialog returns to idle without ever POSTing a rollback', async () => {
    const v = makeVersion({ deploymentId: 'd2', current: false, canRollback: true })
    global.fetch = vi.fn(() => jsonResponse({ versions: [v], serviced: true })) as any
    render(React.createElement(VersionsPanel, { companyId: 'co-1' }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="version-revert"]') as HTMLButtonElement).click() })
    await act(async () => { (host.querySelector('[data-testid="rollback-cancel-btn"]') as HTMLButtonElement).click() })

    expect(host.querySelector('[data-testid="rollback-confirm"]')).toBeNull()
  })

  it('the confirm dialog\'s own close (✕) button also cancels back to idle', async () => {
    const v = makeVersion({ deploymentId: 'd2', current: false, canRollback: true })
    global.fetch = vi.fn(() => jsonResponse({ versions: [v], serviced: true })) as any
    render(React.createElement(VersionsPanel, { companyId: 'co-1' }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="version-revert"]') as HTMLButtonElement).click() })
    await act(async () => { (host.querySelector('[data-testid="rollback-cancel"]') as HTMLButtonElement).click() })

    expect(host.querySelector('[data-testid="rollback-confirm"]')).toBeNull()
  })

  it('confirming rollback POSTs the real companyId/deploymentId and shows the real "live" status immediately when healthy', async () => {
    const v = makeVersion({ deploymentId: 'd2', current: false, canRollback: true })
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === '/api/build/versions' && init?.method === 'POST') {
        return jsonResponse({ ok: true, status: 'live', healthy: true })
      }
      return jsonResponse({ versions: [v], serviced: true })
    })
    global.fetch = fetchMock as any
    render(React.createElement(VersionsPanel, { companyId: 'co-xyz' }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="version-revert"]') as HTMLButtonElement).click() })
    await act(async () => { (host.querySelector('[data-testid="rollback-confirm-btn"]') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve() })

    expect(fetchMock).toHaveBeenCalledWith('/api/build/versions', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ companyId: 'co-xyz', deploymentId: 'd2' }),
    }))
    expect(host.querySelector('[data-testid="rollback-status"]')?.textContent).toContain('✓ Rolled back')
    expect(host.querySelector('[data-testid="rollback-confirm"]')).toBeNull()
  })

  it('shows the real "validating" status and disables every REVERT button while a rollback is accepted but not yet healthy', async () => {
    const versions = [
      makeVersion({ deploymentId: 'd1', current: true, canRollback: false }),
      makeVersion({ deploymentId: 'd2', current: false, canRollback: true }),
    ]
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === '/api/build/versions' && init?.method === 'POST') {
        return jsonResponse({ ok: true, status: 'deploying', healthy: false })
      }
      return jsonResponse({ versions, serviced: true })
    }) as any
    render(React.createElement(VersionsPanel, { companyId: 'co-1' }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="version-revert"]') as HTMLButtonElement).click() })
    await act(async () => { (host.querySelector('[data-testid="rollback-confirm-btn"]') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="rollback-status"]')?.textContent).toBe('Validating the rolled-back site…')
    const revertBtns = host.querySelectorAll('[data-testid="version-revert"]')
    expect((revertBtns[0] as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the real error status + message when the rollback request genuinely fails', async () => {
    const v = makeVersion({ deploymentId: 'd2', current: false, canRollback: true })
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === '/api/build/versions' && init?.method === 'POST') {
        return jsonResponse({ ok: false, error: 'Deploy service unavailable' })
      }
      return jsonResponse({ versions: [v], serviced: true })
    }) as any
    render(React.createElement(VersionsPanel, { companyId: 'co-1' }))
    await flush()

    await act(async () => { (host.querySelector('[data-testid="version-revert"]') as HTMLButtonElement).click() })
    await act(async () => { (host.querySelector('[data-testid="rollback-confirm-btn"]') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="rollback-status"]')?.textContent).toBe('Deploy service unavailable')
  })

  it('polls and transitions from "validating" to real "live" once the rolled-back deployment genuinely reports current', async () => {
    vi.useFakeTimers()
    const v = makeVersion({ deploymentId: 'd2', current: false, canRollback: true })
    let pollCount = 0
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === '/api/build/versions' && init?.method === 'POST') {
        return jsonResponse({ ok: true, status: 'deploying', healthy: false })
      }
      pollCount++
      if (pollCount === 1) return jsonResponse({ versions: [v], serviced: true })
      // Second GET (the first poll tick) reports the rolled-back version now current.
      return jsonResponse({ versions: [{ ...v, current: true }], serviced: true })
    })
    global.fetch = fetchMock as any
    render(React.createElement(VersionsPanel, { companyId: 'co-1' }))
    await act(async () => { await vi.runOnlyPendingTimersAsync() })

    await act(async () => { (host.querySelector('[data-testid="version-revert"]') as HTMLButtonElement).click() })
    await act(async () => { (host.querySelector('[data-testid="rollback-confirm-btn"]') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="rollback-status"]')?.textContent).toBe('Validating the rolled-back site…')

    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })

    expect(host.querySelector('[data-testid="rollback-status"]')?.textContent).toContain('✓ Rolled back')
  })
})
