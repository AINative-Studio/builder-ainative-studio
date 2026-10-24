// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { SettingsForm } from '@/components/build/SettingsForm'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — SettingsForm (components/build/SettingsForm.tsx,
 * 184 lines, reached live via components/build/screens/Account.tsx <-
 * BuildApp.tsx) had zero test coverage. Plain inputs — no Radix — real
 * .click()/native-setter-then-input works directly.
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

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T {
  return host.querySelector(`[data-testid="${id}"]`) as T
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
})

describe('SettingsForm — real load/edit/save coverage (#1204)', () => {
  it('loads the real profile from GET /api/build/profile and populates the real fields', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ profile: { fullName: 'Jane Founder', email: 'jane@acme.com', social: '@janef', contentLanguage: 'es' } })) as any
    render(React.createElement(SettingsForm, {}))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId<HTMLInputElement>('settings-fullname').value).toBe('Jane Founder')
    expect(byTestId<HTMLInputElement>('settings-email').value).toBe('jane@acme.com')
    expect(byTestId<HTMLInputElement>('settings-social').value).toBe('@janef')
    expect(byTestId<HTMLSelectElement>('settings-language').value).toBe('es')
  })

  it('falls back to the real fallbackName/fallbackEmail props when the real profile fetch fails', async () => {
    global.fetch = vi.fn(async () => jsonResponse({}, false)) as any
    render(React.createElement(SettingsForm, { fallbackName: 'Session Name', fallbackEmail: 'session@acme.com' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId<HTMLInputElement>('settings-fullname').value).toBe('Session Name')
    expect(byTestId<HTMLInputElement>('settings-email').value).toBe('session@acme.com')
  })

  it('falls back to the real fallback props on a genuinely rejected fetch, never leaves the form blank', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as any
    render(React.createElement(SettingsForm, { fallbackName: 'Offline Name', fallbackEmail: 'offline@acme.com' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId<HTMLInputElement>('settings-fullname').value).toBe('Offline Name')
  })

  it('disables every real field and the Save button while genuinely loading', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any
    render(React.createElement(SettingsForm, {}))

    expect(byTestId<HTMLInputElement>('settings-fullname').disabled).toBe(true)
    expect(byTestId<HTMLButtonElement>('settings-save').disabled).toBe(true)
  })

  it('a real Save submit fires the real POST with the real form body, shows the real "Saved" status', async () => {
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') return jsonResponse({ ok: true, profile: { fullName: 'Updated Name' } })
      return jsonResponse({ profile: { fullName: 'Jane', email: 'jane@acme.com', social: '', contentLanguage: 'en' } })
    }) as any
    render(React.createElement(SettingsForm, {}))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const nameInput = byTestId<HTMLInputElement>('settings-fullname')
    await act(async () => { setInputValue(nameInput, 'Updated Name') })

    const form = byTestId<HTMLFormElement>('account-settings-form')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve(); await Promise.resolve()
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/build/profile', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ fullName: 'Updated Name', email: 'jane@acme.com', social: '', contentLanguage: 'en' }),
    }))
    expect(byTestId('settings-saved')).not.toBeNull()
    expect(byTestId<HTMLInputElement>('settings-fullname').value).toBe('Updated Name')
  })

  it('typing into any real field resets a real prior "saved" status back to idle', async () => {
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') return jsonResponse({ ok: true })
      return jsonResponse({ profile: { fullName: 'Jane', email: 'jane@acme.com', social: '', contentLanguage: 'en' } })
    }) as any
    render(React.createElement(SettingsForm, {}))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const form = byTestId<HTMLFormElement>('account-settings-form')
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve() })
    expect(byTestId('settings-saved')).not.toBeNull()

    const nameInput = byTestId<HTMLInputElement>('settings-fullname')
    await act(async () => { setInputValue(nameInput, 'Jane 2') })
    expect(byTestId('settings-saved')).toBeNull()
  })

  it('shows the real per-field errors AND never a generic error message when the real save response carries fields', async () => {
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') return jsonResponse({ ok: false, fields: { email: 'Email is already in use' } }, false)
      return jsonResponse({ profile: { fullName: 'Jane', email: 'jane@acme.com', social: '', contentLanguage: 'en' } })
    }) as any
    render(React.createElement(SettingsForm, {}))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const form = byTestId<HTMLFormElement>('account-settings-form')
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('settings-email-err')?.textContent).toBe('Email is already in use')
    expect(byTestId('settings-error')?.textContent).toBe('Please fix the errors above.')
  })

  it('shows the real server error string when the real response carries a plain error with no fields', async () => {
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') return jsonResponse({ ok: false, error: 'Profile service unavailable' }, false)
      return jsonResponse({ profile: { fullName: 'Jane', email: 'jane@acme.com', social: '', contentLanguage: 'en' } })
    }) as any
    render(React.createElement(SettingsForm, {}))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const form = byTestId<HTMLFormElement>('account-settings-form')
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('settings-error')?.textContent).toBe('Profile service unavailable')
  })

  it('shows the real retry message (never a crash) when the real save POST is genuinely rejected', async () => {
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') throw new Error('network down')
      return jsonResponse({ profile: { fullName: 'Jane', email: 'jane@acme.com', social: '', contentLanguage: 'en' } })
    }) as any
    render(React.createElement(SettingsForm, {}))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const form = byTestId<HTMLFormElement>('account-settings-form')
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve() })

    expect(byTestId('settings-error')?.textContent).toBe('Could not save. Please try again.')
  })

  it('renders every real content-language option from the real CONTENT_LANGUAGES list', async () => {
    const { CONTENT_LANGUAGES } = await import('@/lib/build/content-language')
    global.fetch = vi.fn(async () => jsonResponse({ profile: { fullName: '', email: '', social: '', contentLanguage: 'en' } })) as any
    render(React.createElement(SettingsForm, {}))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const options = Array.from(byTestId<HTMLSelectElement>('settings-language').querySelectorAll('option')).map((o) => o.value)
    expect(options).toEqual(CONTENT_LANGUAGES.map((l) => l.code))
  })
})
