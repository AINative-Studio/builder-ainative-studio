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
  const originalFetch = global.fetch
  beforeEach(() => {
    // #479: save() now checks /api/build/name-available before committing.
    // Default to "available" so pre-existing save/cancel behavior is unaffected.
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: true }) })
  })
  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

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

  it('Save calls onChange with the trimmed new name and exits edit mode', async () => {
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={onChange} />,
    )
    const trigger = host.querySelector('[data-testid="company-name-edit-trigger"]') as HTMLButtonElement
    act(() => trigger.click())
    const input = host.querySelector('input') as HTMLInputElement
    act(() => setInputValue(input, '  New Co  '))
    const saveBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Save') as HTMLButtonElement
    await act(async () => {
      saveBtn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onChange).toHaveBeenCalledWith('New Co')
    expect(host.querySelector('input')).toBeFalsy() // back to display mode
  })

  it('Save with a blank name shows an error and does NOT call onChange (never even checks availability)', async () => {
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={onChange} />,
    )
    const trigger = host.querySelector('[data-testid="company-name-edit-trigger"]') as HTMLButtonElement
    act(() => trigger.click())
    const input = host.querySelector('input') as HTMLInputElement
    act(() => setInputValue(input, '   '))
    const saveBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Save') as HTMLButtonElement
    await act(async () => {
      saveBtn.click()
      await Promise.resolve()
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(host.textContent).toContain('empty')
    expect(global.fetch).not.toHaveBeenCalled()
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

describe('CompanyNameEdit — #479 manual-rename advisory collision check', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    global.fetch = vi.fn()
  })
  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  async function typeAndSave(name: string) {
    const trigger = host.querySelector('[data-testid="company-name-edit-trigger"]') as HTMLButtonElement
    act(() => trigger.click())
    const input = host.querySelector('input') as HTMLInputElement
    act(() => setInputValue(input, name))
    const saveBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Save') as HTMLButtonElement
    await act(async () => {
      saveBtn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('an available name saves immediately with no warning (current behavior, unchanged)', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ available: true }) })
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={onChange} chatId="chat-1" />,
    )
    await typeAndSave('Brand New Co')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/build/name-available',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Brand New Co', chatId: 'chat-1' }) }),
    )
    expect(onChange).toHaveBeenCalledWith('Brand New Co')
    expect(host.querySelector('[data-testid="company-name-collision-warning"]')).toBeFalsy()
  })

  it('a name taken by a DIFFERENT company shows a real advisory warning and does NOT save yet', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ available: false, slug: 'dwello', existingName: 'Dwello' }),
    })
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={onChange} chatId="chat-1" />,
    )
    await typeAndSave('Dwello')
    expect(onChange).not.toHaveBeenCalled()
    const warning = host.querySelector('[data-testid="company-name-collision-warning"]')
    expect(warning).toBeTruthy()
    expect(warning!.textContent).toContain('Dwello')
    // still in edit mode — never silently blocked, founder can still act
    expect(host.querySelector('input')).toBeTruthy()
  })

  it('"Use it anyway" commits the taken name exactly as typed', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ available: false, slug: 'dwello', existingName: 'Dwello' }),
    })
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={onChange} chatId="chat-1" />,
    )
    await typeAndSave('Dwello')
    const useAnyway = host.querySelector('[data-testid="company-name-use-anyway"]') as HTMLButtonElement
    act(() => useAnyway.click())
    expect(onChange).toHaveBeenCalledWith('Dwello')
    expect(host.querySelector('input')).toBeFalsy() // back to display mode
    expect(host.querySelector('[data-testid="company-name-collision-warning"]')).toBeFalsy()
  })

  it('editing then reverting to the SAME company\'s own existing name never false-warns', async () => {
    // The registry hit is this company's own chatId — the route itself would
    // return available:true for this case (#479 acceptance criteria), so the
    // component just needs to trust and pass through what the endpoint says.
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ available: true }) })
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={onChange} chatId="chat-1" />,
    )
    await typeAndSave('Acme')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/build/name-available',
      expect.objectContaining({ body: JSON.stringify({ name: 'Acme', chatId: 'chat-1' }) }),
    )
    expect(onChange).toHaveBeenCalledWith('Acme')
    expect(host.querySelector('[data-testid="company-name-collision-warning"]')).toBeFalsy()
  })

  it('a registry-check failure fails open — saves immediately, never blocks on an infra hiccup', async () => {
    ;(global.fetch as any).mockRejectedValue(new Error('network down'))
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={onChange} chatId="chat-1" />,
    )
    await typeAndSave('Whatever Co')
    expect(onChange).toHaveBeenCalledWith('Whatever Co')
    expect(host.querySelector('[data-testid="company-name-collision-warning"]')).toBeFalsy()
  })

  it('editing the draft after a warning clears it (no stale warning on a changed name)', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ available: false, slug: 'dwello', existingName: 'Dwello' }),
    })
    const onChange = vi.fn()
    render(
      <CompanyNameEdit companyName="Acme" idea="an idea" track="company" showRegenerate={false} onChange={onChange} chatId="chat-1" />,
    )
    await typeAndSave('Dwello')
    expect(host.querySelector('[data-testid="company-name-collision-warning"]')).toBeTruthy()
    const input = host.querySelector('input') as HTMLInputElement
    act(() => setInputValue(input, 'Dwello Two'))
    expect(host.querySelector('[data-testid="company-name-collision-warning"]')).toBeFalsy()
  })
})
