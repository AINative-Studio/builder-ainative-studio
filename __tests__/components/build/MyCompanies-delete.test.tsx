// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #649 — the founder-facing delete affordance the audit found missing from
 * both the builder dashboard and My Portfolio. The real soft-delete
 * primitive (setAppLifecycle, POST /api/build/danger) already existed —
 * this adds the actual UI control here, plus the server-side ownership
 * check the endpoint was missing (tested separately in
 * __tests__/api/build-danger.test.ts, per #649's own mandate that the
 * authorization test come before the UI control).
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated' }),
}))
vi.mock('@/lib/build/guest-migration', () => ({ migrateGuestWork: vi.fn(async () => {}) }))
vi.mock('@/components/build/MenuChip', () => ({ MenuChip: () => null }))
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: { activePlan: '' }, dispatch: vi.fn() }),
}))

import { MyCompanies } from '@/components/build/screens/MyCompanies'

const COMPANY = {
  slug: 'ember-box',
  name: 'Ember Box',
  tagline: 'Small batches. Big heat.',
  track: 'company',
  plan: null,
  deployUrl: 'https://builder.ainative.studio/build/ember-box',
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function flush() {
  return act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('MyCompanies — delete affordance (#649)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string, init?: any) => {
      const u = String(url)
      if (u.includes('/api/build/my-companies')) {
        return { ok: true, json: async () => ({ companies: [COMPANY] }) }
      }
      if (u.includes('/api/build/subscription/status')) {
        return { ok: true, json: async () => ({ plan: null }) }
      }
      if (u.includes('/api/build/danger')) {
        const body = JSON.parse(init.body)
        if (body.confirm?.toLowerCase() === COMPANY.name.toLowerCase()) {
          return { ok: true, json: async () => ({ ok: true, action: 'delete' }) }
        }
        return { ok: true, json: async () => ({ error: 'confirmation does not match the company name' }) }
      }
      return { ok: true, json: async () => ({}) }
    })
    global.fetch = fetchMock as any
  })

  afterEach(() => {
    act(() => { root?.unmount() })
    host?.remove()
    vi.clearAllMocks()
  })

  it('renders a Delete button per company', async () => {
    render(React.createElement(MyCompanies))
    await flush()
    const btn = host.querySelector('[data-testid="delete-ember-box"]')
    expect(btn).not.toBeNull()
  })

  it('clicking Delete reveals the typed-confirmation prompt, not an immediate delete', async () => {
    render(React.createElement(MyCompanies))
    await flush()
    const btn = host.querySelector('[data-testid="delete-ember-box"]') as HTMLButtonElement
    act(() => { btn.click() })
    const confirmBox = host.querySelector('[data-testid="delete-confirm-ember-box"]')
    expect(confirmBox).not.toBeNull()
    const dangerCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/build/danger'))
    expect(dangerCall).toBeUndefined() // no request fired yet — just the prompt
  })

  it('the submit button stays disabled until the typed text exactly matches the company name', async () => {
    render(React.createElement(MyCompanies))
    await flush()
    const deleteBtn = host.querySelector('[data-testid="delete-ember-box"]') as HTMLButtonElement
    act(() => { deleteBtn.click() })

    const submitBtn = host.querySelector('[data-testid="delete-confirm-submit-ember-box"]') as HTMLButtonElement
    expect(submitBtn.disabled).toBe(true)

    const input = host.querySelector('[data-testid="delete-confirm-input-ember-box"]') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'wrong name')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(submitBtn.disabled).toBe(true)

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Ember Box')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(submitBtn.disabled).toBe(false)
  })

  it('a confirmed delete removes the company from the list (optimistic update)', async () => {
    render(React.createElement(MyCompanies))
    await flush()
    const deleteBtn = host.querySelector('[data-testid="delete-ember-box"]') as HTMLButtonElement
    act(() => { deleteBtn.click() })

    const input = host.querySelector('[data-testid="delete-confirm-input-ember-box"]') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Ember Box')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const submitBtn = host.querySelector('[data-testid="delete-confirm-submit-ember-box"]') as HTMLButtonElement
    await act(async () => { submitBtn.click(); await Promise.resolve(); await Promise.resolve() })

    const dangerCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/build/danger'))
    expect(dangerCall).toBeDefined()
    const body = JSON.parse(dangerCall![1].body)
    expect(body).toMatchObject({ action: 'delete', companyId: 'ember-box', confirm: 'Ember Box' })

    expect(host.querySelector('[data-testid="company-ember-box"]')).toBeNull()
  })

  it('an ownership rejection (403 not_owner) shows an honest error, never a false success', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      const u = String(url)
      if (u.includes('/api/build/my-companies')) return { ok: true, json: async () => ({ companies: [COMPANY] }) }
      if (u.includes('/api/build/subscription/status')) return { ok: true, json: async () => ({ plan: null }) }
      if (u.includes('/api/build/danger')) return { ok: false, status: 403, json: async () => ({ error: 'not_owner' }) }
      return { ok: true, json: async () => ({}) }
    })
    render(React.createElement(MyCompanies))
    await flush()
    const deleteBtn = host.querySelector('[data-testid="delete-ember-box"]') as HTMLButtonElement
    act(() => { deleteBtn.click() })
    const input = host.querySelector('[data-testid="delete-confirm-input-ember-box"]') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Ember Box')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const submitBtn = host.querySelector('[data-testid="delete-confirm-submit-ember-box"]') as HTMLButtonElement
    await act(async () => { submitBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="company-ember-box"]')).not.toBeNull() // still present, not falsely removed
    const err = host.querySelector('[data-testid="delete-error-ember-box"]')
    expect(err?.textContent).toMatch(/not the owner/i)
  })
})
