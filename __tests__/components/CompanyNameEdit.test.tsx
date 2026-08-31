// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { CompanyNameEdit } from '@/components/build/CompanyNameEdit'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #396 — real jsdom render tests for the editable-company-name control
 * (click-to-edit + save/cancel, and the plan30-only Regenerate action that
 * calls the real /api/build/brand endpoint, mocked here at the fetch
 * boundary). Follows the same real-render pattern already established in
 * __tests__/components/aikit-hardening.test.ts (createRoot + act, no
 * @testing-library needed).
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

/** React's controlled-input model needs the value set via the NATIVE input
 *  value setter (bypassing React's own tracked-value shadowing) before
 *  dispatching the input event, or React never sees the change — a plain
 *  `input.value = x; dispatchEvent(...)` silently no-ops under jsdom. */
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('CompanyNameEdit — display + click-to-edit', () => {
  afterEach(() => unmount())

  it('renders the current company name as a clickable label', () => {
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={() => {}} />,
    )
    expect(host.textContent).toContain('Acme')
    expect(host.querySelector('[data-testid="company-name-edit-trigger"]')).toBeTruthy()
  })

  it('falls back to "company" when the name is empty', () => {
    render(
      <CompanyNameEdit companyName="" idea="an idea" track="company" showRegenerate={false} onChange={() => {}} />,
    )
    expect(host.textContent).toContain('company')
  })

  it('clicking the label switches to edit mode with an input pre-filled', () => {
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={() => {}} />,
    )
    const trigger = host.querySelector('[data-testid="company-name-edit-trigger"]') as HTMLButtonElement
    act(() => trigger.click())
    const input = host.querySelector('input') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.value).toBe('Acme')
  })

  it('Save calls onChange with the trimmed new name and exits edit mode', () => {
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={onChange} />,
    )
    const trigger = host.querySelector('[data-testid="company-name-edit-trigger"]') as HTMLButtonElement
    act(() => trigger.click())
    const input = host.querySelector('input') as HTMLInputElement
    act(() => setInputValue(input, '  New Co  '))
    const saveBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Save') as HTMLButtonElement
    act(() => saveBtn.click())
    expect(onChange).toHaveBeenCalledWith('New Co')
    expect(host.querySelector('input')).toBeFalsy() // back to display mode
  })

  it('Save with a blank name shows an error and does NOT call onChange', () => {
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={onChange} />,
    )
    const trigger = host.querySelector('[data-testid="company-name-edit-trigger"]') as HTMLButtonElement
    act(() => trigger.click())
    const input = host.querySelector('input') as HTMLInputElement
    act(() => setInputValue(input, '   '))
    const saveBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Save') as HTMLButtonElement
    act(() => saveBtn.click())
    expect(onChange).not.toHaveBeenCalled()
    expect(host.textContent).toContain('empty')
  })

  it('Cancel discards the draft and returns to display mode without calling onChange', () => {
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={onChange} />,
    )
    const trigger = host.querySelector('[data-testid="company-name-edit-trigger"]') as HTMLButtonElement
    act(() => trigger.click())
    const cancelBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Cancel') as HTMLButtonElement
    act(() => cancelBtn.click())
    expect(onChange).not.toHaveBeenCalled()
    expect(host.querySelector('input')).toBeFalsy()
  })

  it('does NOT show the Regenerate action when showRegenerate is false', () => {
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={() => {}} />,
    )
    expect(host.querySelector('[data-testid="company-name-regenerate"]')).toBeFalsy()
  })
})

describe('CompanyNameEdit — Regenerate (plan30-only)', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    global.fetch = vi.fn()
  })
  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  it('shows the Regenerate action when showRegenerate is true', () => {
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate onChange={() => {}} />,
    )
    expect(host.querySelector('[data-testid="company-name-regenerate"]')).toBeTruthy()
  })

  it('clicking Regenerate calls /api/build/brand and onChange with only the new name', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'Zenith', slug: 'zenith', tagline: 'new tagline', color: '#000' }),
    })
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="a real idea" track="company" showRegenerate onChange={onChange} />,
    )
    const btn = host.querySelector('[data-testid="company-name-regenerate"]') as HTMLButtonElement
    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/build/brand',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ idea: 'a real idea', track: 'company' }),
      }),
    )
    // Only the name is taken — onChange's contract is (name: string), so
    // slug/tagline/color from the response are never touched by this component.
    expect(onChange).toHaveBeenCalledWith('Zenith')
  })

  it('a failed regenerate call shows an error and never calls onChange', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: false, json: async () => ({}) })
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate onChange={onChange} />,
    )
    const btn = host.querySelector('[data-testid="company-name-regenerate"]') as HTMLButtonElement
    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Couldn')
  })

  it('a network error is handled honestly — never throws, never fabricates success', async () => {
    ;(global.fetch as any).mockRejectedValue(new Error('network down'))
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate onChange={onChange} />,
    )
    const btn = host.querySelector('[data-testid="company-name-regenerate"]') as HTMLButtonElement
    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Couldn')
  })
})
