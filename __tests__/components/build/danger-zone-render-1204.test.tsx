// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { DangerZone } from '@/components/build/DangerZone'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — DangerZone (components/build/DangerZone.tsx,
 * 170 lines, reached live via components/build/screens/Account.tsx) had
 * zero test coverage despite gating real destructive actions (take app
 * offline, delete company) behind a real typed-confirmation guard. Plain
 * inputs, no Radix.
 */

function jsonResponse(data: any, ok = true) {
  return { ok, json: async () => data }
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return host.querySelector(`[data-testid="${id}"]`) as T | null
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function baseProps(overrides: Record<string, any> = {}) {
  return { companyId: 'co-1', companyName: 'Acme Co', slug: 'acme-co', track: 'company' as const, ...overrides }
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
})

describe('DangerZone — real confirmation-gate/action coverage (#1204)', () => {
  it('shows the real honest "no company" note instead of dangerous buttons when there is genuinely no active company', () => {
    render(React.createElement(DangerZone, baseProps({ companyId: '', companyName: '' })))
    expect(byTestId('danger-no-company')).not.toBeNull()
    expect(byTestId('danger-pause')).toBeNull()
  })

  it('a real Pause click fires the real POST with action:pause and no confirm field, shows the real success result', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ ok: true })) as any
    render(React.createElement(DangerZone, baseProps()))

    await act(async () => { byTestId<HTMLButtonElement>('danger-pause')!.click(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/build/danger', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'pause', companyId: 'co-1', companyName: 'Acme Co', slug: 'acme-co', track: 'company', confirm: undefined }),
    }))
    expect(byTestId('danger-result-ok')?.textContent).toContain('Loop paused')
  })

  it('a real "Take offline" click opens the real confirmation prompt, and clicking it again closes it', async () => {
    render(React.createElement(DangerZone, baseProps()))

    expect(byTestId('danger-confirm')).toBeNull()
    await act(async () => { byTestId<HTMLButtonElement>('danger-offline')!.click() })
    expect(byTestId('danger-confirm')).not.toBeNull()
    expect(byTestId('danger-confirm')?.textContent).toContain('take offline')

    await act(async () => { byTestId<HTMLButtonElement>('danger-offline')!.click() })
    expect(byTestId('danger-confirm')).toBeNull()
  })

  it('the real confirm button is disabled until the real typed text matches the company name exactly', async () => {
    render(React.createElement(DangerZone, baseProps({ companyName: 'Acme Co' })))
    await act(async () => { byTestId<HTMLButtonElement>('danger-delete')!.click() })

    const input = byTestId<HTMLInputElement>('danger-confirm-input')!
    const confirmBtn = byTestId<HTMLButtonElement>('danger-confirm-submit')!
    expect(confirmBtn.disabled).toBe(true)

    await act(async () => { setInputValue(input, 'Wrong Name') })
    expect(confirmBtn.disabled).toBe(true)

    await act(async () => { setInputValue(input, 'Acme Co') })
    expect(confirmBtn.disabled).toBe(false)
  })

  it('the real confirm match is genuinely case-insensitive and trims whitespace', async () => {
    render(React.createElement(DangerZone, baseProps({ companyName: 'Acme Co' })))
    await act(async () => { byTestId<HTMLButtonElement>('danger-delete')!.click() })

    const input = byTestId<HTMLInputElement>('danger-confirm-input')!
    await act(async () => { setInputValue(input, '  acme co  ') })

    expect(byTestId<HTMLButtonElement>('danger-confirm-submit')!.disabled).toBe(false)
  })

  it('a real confirmed Delete click fires the real POST with action:delete and the real trimmed confirm text, then closes the prompt', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ ok: true })) as any
    render(React.createElement(DangerZone, baseProps({ companyName: 'Acme Co' })))
    await act(async () => { byTestId<HTMLButtonElement>('danger-delete')!.click() })

    const input = byTestId<HTMLInputElement>('danger-confirm-input')!
    await act(async () => { setInputValue(input, '  Acme Co  ') })
    await act(async () => { byTestId<HTMLButtonElement>('danger-confirm-submit')!.click(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/build/danger', expect.objectContaining({
      body: JSON.stringify({ action: 'delete', companyId: 'co-1', companyName: 'Acme Co', slug: 'acme-co', track: 'company', confirm: 'Acme Co' }),
    }))
    expect(byTestId('danger-confirm')).toBeNull()
    expect(byTestId('danger-result-ok')?.textContent).toBe('Company deleted.')
  })

  it('a real Cancel click in the confirmation prompt closes it without ever POSTing', async () => {
    global.fetch = vi.fn() as any
    render(React.createElement(DangerZone, baseProps()))
    await act(async () => { byTestId<HTMLButtonElement>('danger-offline')!.click() })

    await act(async () => { byTestId<HTMLButtonElement>('danger-confirm-cancel')!.click() })

    expect(byTestId('danger-confirm')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('shows the real server error message (never a silent failure) when the real action POST fails', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ ok: false, error: 'Company is already offline' }, false)) as any
    render(React.createElement(DangerZone, baseProps({ companyName: 'Acme Co' })))
    await act(async () => { byTestId<HTMLButtonElement>('danger-offline')!.click() })

    const input = byTestId<HTMLInputElement>('danger-confirm-input')!
    await act(async () => { setInputValue(input, 'Acme Co') })
    await act(async () => { byTestId<HTMLButtonElement>('danger-confirm-submit')!.click(); await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('danger-result-err')?.textContent).toBe('Company is already offline')
    // The confirmation prompt stays open on a real failure (never silently closes).
    expect(byTestId('danger-confirm')).not.toBeNull()
  })

  it('shows a real generic retry message (never a crash) when the real action POST is genuinely rejected', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as any
    render(React.createElement(DangerZone, baseProps()))

    await act(async () => { byTestId<HTMLButtonElement>('danger-pause')!.click(); await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('danger-result-err')?.textContent).toBe('Action failed. Please try again.')
  })

  it('disables every real action button while genuinely busy, and shows the real "Working…" label on the confirm submit', async () => {
    let resolveFetch: (v: any) => void = () => {}
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve })) as any
    render(React.createElement(DangerZone, baseProps({ companyName: 'Acme Co' })))
    await act(async () => { byTestId<HTMLButtonElement>('danger-delete')!.click() })

    const input = byTestId<HTMLInputElement>('danger-confirm-input')!
    await act(async () => { setInputValue(input, 'Acme Co') })
    await act(async () => { byTestId<HTMLButtonElement>('danger-confirm-submit')!.click() })

    expect(byTestId<HTMLButtonElement>('danger-confirm-submit')!.textContent).toBe('Working…')
    expect(byTestId<HTMLButtonElement>('danger-pause')!.disabled).toBe(true)

    await act(async () => { resolveFetch(jsonResponse({ ok: true })); await Promise.resolve(); await Promise.resolve() })
  })
})
