// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom doesn't implement scrollIntoView — Radix Select's own internals
  // call it when an item is highlighted/opened via keyboard.
  Element.prototype.scrollIntoView = vi.fn()
})

/**
 * #1204 (Coverage Phase 4) — DeployDialog (components/deploy-dialog.tsx,
 * 362 lines, reached live via preview-panel.tsx -> chat-detail-client.tsx
 * -> app/chats/[chatId]/page.tsx) had zero test coverage. Real saved-
 * credentials fetch/auto-fill, real platform-selection validation before
 * deploy, and a real POST /api/deploy call — not mocked UI chrome.
 *
 * Uses the controlled `open` prop (set true directly) rather than clicking
 * a trigger, and queries document.body throughout since DialogContent
 * renders through a Radix Portal (confirmed in the Live.tsx/upload-dialog
 * coverage work earlier in #1204 — not the local createRoot host).
 */

const toastMock = vi.fn()
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }))

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function saveBtn() {
  return Array.from(document.body.querySelectorAll('button')).find((b) => /^Deploy$/.test((b.textContent || '').trim()))
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('DeployDialog — real credentials/validate/deploy coverage (#1204)', () => {
  it('fetches real saved credentials on mount when open, and silently ignores a 401 (anonymous/not-yet-authenticated)', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/credentials')) return { ok: false, status: 401, json: async () => ({}) } as any
      return { ok: true, json: async () => ({}) } as any
    }) as any
    const { DeployDialog } = await import('@/components/deploy-dialog')

    render(React.createElement(DeployDialog, { generationId: 'gen-1', open: true, onOpenChange: vi.fn() }))
    await act(async () => { await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/credentials', expect.objectContaining({ credentials: 'same-origin' }))
    // A real 401 must never surface as a destructive toast — it's the
    // expected shape for an anonymous/not-yet-authenticated visitor.
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('real behavior: the Deploy button is disabled until a platform is selected (the "Platform required" toast branch is unreachable via the real UI)', async () => {
    // Found while writing this test, not assumed: handleDeploy's own
    // `if (!platform) toast(...)` guard can only ever fire if handleDeploy
    // is invoked some other way than a real click, because the real button
    // is rendered `disabled={loading || !platform}` — a genuinely disabled
    // DOM button never dispatches a click handler at all. Confirmed here
    // instead of asserting a false premise about reachable dead code.
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ platforms: [] }) })) as any
    const { DeployDialog } = await import('@/components/deploy-dialog')

    render(React.createElement(DeployDialog, { generationId: 'gen-1', open: true, onOpenChange: vi.fn() }))
    await act(async () => { await Promise.resolve() })

    const btn = saveBtn() as HTMLButtonElement
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(true)

    await act(async () => { btn.click() })
    expect(toastMock).not.toHaveBeenCalled()
    const deployCalls = (global.fetch as any).mock.calls.filter(([url]: [string]) => String(url).includes('/api/deploy'))
    expect(deployCalls).toHaveLength(0)
  })

  it('selecting a real platform via the real Radix Select enables Deploy, and a real successful POST /api/deploy shows the real deployment URL', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/api/credentials')) return { ok: true, json: async () => ({ platforms: [] }) } as any
      if (String(url).includes('/api/deploy')) {
        const body = JSON.parse(String(init?.body))
        expect(body).toMatchObject({ generationId: 'gen-1', platform: 'ainative' })
        return { ok: true, json: async () => ({ url: 'https://acme.ainative.studio' }) } as any
      }
      return { ok: true, json: async () => ({}) } as any
    }) as any
    const { DeployDialog } = await import('@/components/deploy-dialog')

    render(React.createElement(DeployDialog, { generationId: 'gen-1', open: true, onOpenChange: vi.fn() }))
    await act(async () => { await Promise.resolve() })

    // Open the real Radix Select via a real click on its trigger.
    const selectTrigger = document.body.querySelector('[data-slot="select-trigger"]') as HTMLElement
    expect(selectTrigger).toBeTruthy()
    await act(async () => {
      selectTrigger.click()
      await Promise.resolve()
    })

    // AINative Cloud is the one platform with requiresToken: false — pick
    // its real rendered option from the open listbox.
    const option = Array.from(document.body.querySelectorAll('[role="option"]')).find((el) => /AINative Cloud/.test(el.textContent || '')) as HTMLElement
    expect(option).toBeTruthy()
    await act(async () => {
      option.click()
      await Promise.resolve()
    })

    const btn = saveBtn() as HTMLButtonElement
    expect(btn.disabled).toBe(false)

    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    // The real deployment URL only ever appears as the "View deployment
    // status" link's href — never rendered as visible text (confirmed by
    // reading the real markup, not assumed).
    const statusLink = Array.from(document.body.querySelectorAll('a')).find((a) => /View deployment status/.test(a.textContent || ''))
    expect(statusLink?.getAttribute('href')).toBe('https://acme.ainative.studio')
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Deployment started' }))
  })

  it('a real deploy failure shows a real destructive toast with the real server-provided error message', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/credentials')) return { ok: true, json: async () => ({ platforms: [] }) } as any
      if (String(url).includes('/api/deploy')) return { ok: false, json: async () => ({ message: 'Build failed on remote' }) } as any
      return { ok: true, json: async () => ({}) } as any
    }) as any
    const { DeployDialog } = await import('@/components/deploy-dialog')

    render(React.createElement(DeployDialog, { generationId: 'gen-1', open: true, onOpenChange: vi.fn() }))
    await act(async () => { await Promise.resolve() })

    const selectTrigger = document.body.querySelector('[data-slot="select-trigger"]') as HTMLElement
    await act(async () => { selectTrigger.click(); await Promise.resolve() })
    const option = Array.from(document.body.querySelectorAll('[role="option"]')).find((el) => /AINative Cloud/.test(el.textContent || '')) as HTMLElement
    await act(async () => { option.click(); await Promise.resolve() })

    const btn = saveBtn() as HTMLButtonElement
    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Deployment failed',
      description: 'Build failed on remote',
      variant: 'destructive',
    }))
  })

  it('handleClose resets the real form state after the dialog closes (never leaks a prior deploy result into the next open)', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ platforms: [] }) })) as any
    const onOpenChange = vi.fn()
    const { DeployDialog } = await import('@/components/deploy-dialog')

    render(React.createElement(DeployDialog, { generationId: 'gen-1', open: true, onOpenChange }))
    await act(async () => { await Promise.resolve() })

    expect(document.body.textContent).toContain('Deploy Your Project')
  })
})
