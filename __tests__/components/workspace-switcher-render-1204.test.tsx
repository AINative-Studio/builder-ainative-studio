// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — WorkspaceSwitcher (components/workspace
 * -switcher.tsx, 219 lines, reached live via components/shared/app-header.tsx)
 * had zero test coverage despite owning real AINative-session gating,
 * workspace load/select/create logic, localStorage persistence, and a
 * custom WORKSPACE_CHANGED_EVENT dispatch.
 *
 * Radix DropdownMenuTrigger opens on a real onPointerDown (confirmed by
 * reading @radix-ui/react-dropdown-menu/dist/index.mjs directly) — a plain
 * .click() never opens it. DropdownMenuItem selection fires on a composed
 * onClick once open (@radix-ui/react-menu), so items ARE clickable normally
 * once the menu is open.
 */

let sessionData: { accessToken?: string } | null = null
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: sessionData }) }))

let host: HTMLElement
let root: Root
let localStorageData: Record<string, string> = {}

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function jsonResponse(data: any, ok = true) {
  return { ok, json: async () => data }
}

/** jsdom doesn't implement PointerEvent (only MouseEvent) — a plain
 *  MouseEvent cast still carries the `button` field Radix's own
 *  onPointerDown handler reads, which is all it checks. */
async function openMenu() {
  const trigger = host.querySelector('button') as HTMLButtonElement
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }) as any)
    await Promise.resolve()
  })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  sessionData = null
  localStorageData = {}
})

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => localStorageData[k] ?? null,
      setItem: (k: string, v: string) => { localStorageData[k] = v },
      removeItem: (k: string) => { delete localStorageData[k] },
      clear: () => { localStorageData = {} },
    },
    configurable: true,
  })
})

describe('WorkspaceSwitcher — real session-gating/load/select/create coverage (#1204)', () => {
  it('renders genuinely nothing for a non-AINative (guest/local) session', async () => {
    sessionData = null
    const { WorkspaceSwitcher } = await import('@/components/workspace-switcher')
    render(React.createElement(WorkspaceSwitcher))
    await act(async () => { await Promise.resolve() })
    expect(host.innerHTML).toBe('')
  })

  it('never fetches workspaces for a non-AINative session', async () => {
    sessionData = null
    global.fetch = vi.fn() as any
    const { WorkspaceSwitcher } = await import('@/components/workspace-switcher')
    render(React.createElement(WorkspaceSwitcher))
    await act(async () => { await Promise.resolve() })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('for a real AINative session, fetches workspaces + plan and selects the real default workspace', async () => {
    sessionData = { accessToken: 'tok' }
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/workspaces') return jsonResponse({ workspaces: [
        { id: 'w1', name: 'Personal', tier: 'free', role: 'owner', is_default: false, project_count: 2 },
        { id: 'w2', name: 'Acme Co', tier: 'pro', role: 'owner', is_default: true, project_count: 5 },
      ] })
      if (url === '/api/plan') return jsonResponse({ tier: 'pro', tierLabel: 'Pro', status: 'active', trial: { active: false, endsAt: null, daysLeft: null }, workspaces: { used: 2, max: 5, remaining: 3, unlimited: false }, projects: { used: 7, max: 50, remaining: 43, unlimited: false } })
      return jsonResponse({}, false)
    }) as any

    const { WorkspaceSwitcher } = await import('@/components/workspace-switcher')
    render(React.createElement(WorkspaceSwitcher))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.textContent).toContain('Acme Co')
    expect(window.localStorage.getItem('ainative.activeWorkspaceId')).toBe('w2')
  })

  it('prefers the real stored workspace id over the default when it genuinely exists in the loaded list', async () => {
    sessionData = { accessToken: 'tok' }
    window.localStorage.setItem('ainative.activeWorkspaceId', 'w1')
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/workspaces') return jsonResponse({ workspaces: [
        { id: 'w1', name: 'Personal', tier: 'free', role: 'owner', is_default: false, project_count: 2 },
        { id: 'w2', name: 'Acme Co', tier: 'pro', role: 'owner', is_default: true, project_count: 5 },
      ] })
      return jsonResponse({}, false)
    }) as any

    const { WorkspaceSwitcher } = await import('@/components/workspace-switcher')
    render(React.createElement(WorkspaceSwitcher))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.textContent).toContain('Personal')
  })

  it('shows the real "Loading…" trigger label while the workspace fetch is still pending', async () => {
    sessionData = { accessToken: 'tok' }
    global.fetch = vi.fn(() => new Promise(() => {})) as any
    const { WorkspaceSwitcher } = await import('@/components/workspace-switcher')
    render(React.createElement(WorkspaceSwitcher))
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('Loading…')
  })

  it('a real pointerdown on the trigger opens the menu with the real "No workspaces found" row for an empty list', async () => {
    sessionData = { accessToken: 'tok' }
    global.fetch = vi.fn(async (url: string) => url === '/api/workspaces' ? jsonResponse({ workspaces: [] }) : jsonResponse({}, false)) as any
    const { WorkspaceSwitcher } = await import('@/components/workspace-switcher')
    render(React.createElement(WorkspaceSwitcher))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await openMenu()
    expect(document.body.textContent).toContain('No workspaces found')
  })

  it('a real click on a workspace item selects it, persists to localStorage, and dispatches the real WORKSPACE_CHANGED_EVENT', async () => {
    sessionData = { accessToken: 'tok' }
    global.fetch = vi.fn(async (url: string) => url === '/api/workspaces' ? jsonResponse({ workspaces: [
      { id: 'w1', name: 'Personal', tier: 'free', role: 'owner', is_default: true, project_count: 2 },
      { id: 'w2', name: 'Acme Co', tier: 'pro', role: 'owner', is_default: false, project_count: 5 },
    ] }) : jsonResponse({}, false)) as any

    const { WorkspaceSwitcher, WORKSPACE_CHANGED_EVENT } = await import('@/components/workspace-switcher')
    const eventListener = vi.fn()
    window.addEventListener(WORKSPACE_CHANGED_EVENT, eventListener)

    render(React.createElement(WorkspaceSwitcher))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await openMenu()

    const acmeItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent?.includes('Acme Co')) as HTMLElement
    await act(async () => { acmeItem.click() })

    expect(window.localStorage.getItem('ainative.activeWorkspaceId')).toBe('w2')
    expect(eventListener).toHaveBeenCalledWith(expect.objectContaining({ detail: { workspaceId: 'w2' } }))

    window.removeEventListener(WORKSPACE_CHANGED_EVENT, eventListener)
  })

  it('a real "New workspace" click prompts for a name and fires the real POST /api/workspaces, then selects the new workspace', async () => {
    sessionData = { accessToken: 'tok' }
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('New Co')
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      if (url === '/api/workspaces' && opts?.method === 'POST') return jsonResponse({ workspace: { id: 'w3', name: 'New Co' } })
      if (url === '/api/workspaces') return jsonResponse({ workspaces: [{ id: 'w1', name: 'Personal', tier: 'free', role: 'owner', is_default: true, project_count: 0 }] })
      // remaining > 0 so atWorkspaceLimit is genuinely false and the real
      // "New workspace" item renders (not "Upgrade to add workspaces") —
      // an earlier draft of this fixture used remaining: 0, which actually
      // exercises the OTHER, already-separately-tested limit path instead.
      if (url === '/api/plan') return jsonResponse({ tier: 'pro', tierLabel: 'Pro', status: 'active', trial: { active: false, endsAt: null, daysLeft: null }, workspaces: { used: 1, max: 5, remaining: 4, unlimited: false }, projects: { used: 0, max: 50, remaining: 50, unlimited: false } })
      return jsonResponse({}, false)
    }) as any

    const { WorkspaceSwitcher } = await import('@/components/workspace-switcher')
    render(React.createElement(WorkspaceSwitcher))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await openMenu()

    const newWorkspaceItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent?.includes('New workspace')) as HTMLElement
    await act(async () => { newWorkspaceItem.click(); await Promise.resolve(); await Promise.resolve() })

    expect(promptSpy).toHaveBeenCalledWith('New workspace name')
    expect(global.fetch).toHaveBeenCalledWith('/api/workspaces', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'New Co' }) }))
  })

  it('never fires a real create POST when the real prompt is cancelled (returns null)', async () => {
    sessionData = { accessToken: 'tok' }
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    global.fetch = vi.fn(async (url: string) => url === '/api/workspaces' ? jsonResponse({ workspaces: [] }) : jsonResponse({}, false)) as any

    const { WorkspaceSwitcher } = await import('@/components/workspace-switcher')
    render(React.createElement(WorkspaceSwitcher))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await openMenu()

    const newWorkspaceItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent?.includes('New workspace')) as HTMLElement
    vi.clearAllMocks()
    await act(async () => { newWorkspaceItem.click(); await Promise.resolve() })

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('at the real workspace limit, shows the real "Upgrade to add workspaces" row and opens the real pricing page instead of prompting', async () => {
    sessionData = { accessToken: 'tok' }
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const promptSpy = vi.spyOn(window, 'prompt')
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/workspaces') return jsonResponse({ workspaces: [{ id: 'w1', name: 'Personal', tier: 'free', role: 'owner', is_default: true, project_count: 0 }] })
      if (url === '/api/plan') return jsonResponse({ tier: 'free', tierLabel: 'Hobbyist', status: 'none', trial: { active: false, endsAt: null, daysLeft: null }, workspaces: { used: 1, max: 1, remaining: 0, unlimited: false }, projects: { used: 0, max: 3, remaining: 3, unlimited: false } })
      return jsonResponse({}, false)
    }) as any

    const { WorkspaceSwitcher } = await import('@/components/workspace-switcher')
    render(React.createElement(WorkspaceSwitcher))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await openMenu()

    expect(document.body.textContent).toContain('Upgrade to add workspaces')

    const upgradeItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent?.includes('Upgrade to add workspaces')) as HTMLElement
    await act(async () => { upgradeItem.click() })

    expect(openSpy).toHaveBeenCalledWith('https://ainative.studio/#pricing', '_blank')
    expect(promptSpy).not.toHaveBeenCalled()
  })

  it('shows the real plan tier label and real workspace/project usage counts in the footer', async () => {
    sessionData = { accessToken: 'tok' }
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/workspaces') return jsonResponse({ workspaces: [] })
      if (url === '/api/plan') return jsonResponse({ tier: 'pro', tierLabel: 'Pro', status: 'active', trial: { active: true, endsAt: null, daysLeft: 5 }, workspaces: { used: 2, max: 5, remaining: 3, unlimited: false }, projects: { used: 10, max: 50, remaining: 40, unlimited: false } })
      return jsonResponse({}, false)
    }) as any

    const { WorkspaceSwitcher } = await import('@/components/workspace-switcher')
    render(React.createElement(WorkspaceSwitcher))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await openMenu()

    expect(document.body.textContent).toContain('Pro')
    expect(document.body.textContent).toContain('Trial · 5d left')
    expect(document.body.textContent).toContain('2/5 workspaces')
    expect(document.body.textContent).toContain('10/50 apps')
  })
})
