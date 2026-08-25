import { describe, it, expect, vi } from 'vitest'

// Stub framework dependencies that can't resolve in the node test environment.
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }))
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return { ...actual, useRef: vi.fn(() => ({ current: null })), useEffect: vi.fn(), useCallback: vi.fn((fn) => fn) }
})

import { buildMenuItems } from '@/components/build/AccountMenu'

/**
 * #56 — unit tests for the AccountMenu item-generation logic.
 *
 * We test `buildMenuItems` (a pure function) for:
 *   1. Item count and ordering are stable.
 *   2. Guest state: only help is enabled; portfolio/credits/billing/settings carry
 *      a badge and are disabled; refer is disabled with badge; auth row = 'Sign up / Log in'.
 *   3. Authed state: portfolio/credits/billing/settings/help are enabled;
 *      refer is still disabled (not built); bottom row = 'Log out'.
 *   4. Exact id/label/glyph contracts so routing never silently drifts.
 *
 * Coverage target ≥80% on components/build/AccountMenu.tsx (pure logic only —
 * React hooks / DOM interactions are covered by the Playwright E2E).
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function menuById(isGuest: boolean, id: string) {
  return buildMenuItems(isGuest).find((m) => m.id === id)
}

// ── Item count + ordering ─────────────────────────────────────────────────────

describe('buildMenuItems — structure', () => {
  it('returns exactly 7 items for a guest', () => {
    expect(buildMenuItems(true)).toHaveLength(7)
  })

  it('returns exactly 7 items for an authenticated user', () => {
    expect(buildMenuItems(false)).toHaveLength(7)
  })

  it('preserves stable ordering: portfolio, credits, billing, settings, help, refer, auth/logout', () => {
    const ids = buildMenuItems(true).map((m) => m.id)
    expect(ids).toEqual(['portfolio', 'credits', 'billing', 'settings', 'help', 'refer', 'auth'])
  })

  it('last item is "logout" for authenticated users', () => {
    const ids = buildMenuItems(false).map((m) => m.id)
    expect(ids[ids.length - 1]).toBe('logout')
  })
})

// ── Guest state ───────────────────────────────────────────────────────────────

describe('buildMenuItems — guest session', () => {
  it('portfolio is disabled for guest', () => {
    expect(menuById(true, 'portfolio')!.enabled).toBe(false)
  })

  it('portfolio carries a "Sign in" badge for guest', () => {
    expect(menuById(true, 'portfolio')!.badge).toBeTruthy()
  })

  it('credits is disabled for guest', () => {
    expect(menuById(true, 'credits')!.enabled).toBe(false)
  })

  it('billing is disabled for guest', () => {
    expect(menuById(true, 'billing')!.enabled).toBe(false)
  })

  it('settings is disabled for guest', () => {
    expect(menuById(true, 'settings')!.enabled).toBe(false)
  })

  it('help is enabled for guest', () => {
    expect(menuById(true, 'help')!.enabled).toBe(true)
  })

  it('refer is disabled for guest (not built yet)', () => {
    expect(menuById(true, 'refer')!.enabled).toBe(false)
  })

  it('refer carries a badge for guest', () => {
    expect(menuById(true, 'refer')!.badge).toBeTruthy()
  })

  it('auth item label is "Sign up / Log in" for guest', () => {
    expect(menuById(true, 'auth')!.label).toBe('Sign up / Log in')
  })

  it('auth item glyph is "→" for guest', () => {
    expect(menuById(true, 'auth')!.glyph).toBe('→')
  })

  it('auth item is enabled (the main CTA for guest)', () => {
    expect(menuById(true, 'auth')!.enabled).toBe(true)
  })

  it('no "logout" item exists for guest', () => {
    expect(menuById(true, 'logout')).toBeUndefined()
  })
})

// ── Authenticated state ───────────────────────────────────────────────────────

describe('buildMenuItems — authenticated session', () => {
  it('portfolio is enabled for authenticated user', () => {
    expect(menuById(false, 'portfolio')!.enabled).toBe(true)
  })

  it('portfolio has no badge for authenticated user', () => {
    expect(menuById(false, 'portfolio')!.badge).toBeUndefined()
  })

  it('credits is enabled for authenticated user', () => {
    expect(menuById(false, 'credits')!.enabled).toBe(true)
  })

  it('billing is enabled for authenticated user', () => {
    expect(menuById(false, 'billing')!.enabled).toBe(true)
  })

  it('settings is enabled for authenticated user', () => {
    expect(menuById(false, 'settings')!.enabled).toBe(true)
  })

  it('help is enabled for authenticated user', () => {
    expect(menuById(false, 'help')!.enabled).toBe(true)
  })

  it('refer is disabled for authenticated user (feature not shipped)', () => {
    expect(menuById(false, 'refer')!.enabled).toBe(false)
  })

  it('refer carries a badge for authenticated user', () => {
    expect(menuById(false, 'refer')!.badge).toBeTruthy()
  })

  it('logout item label is "Log out" for authenticated user', () => {
    expect(menuById(false, 'logout')!.label).toBe('Log out')
  })

  it('logout item glyph is "↩" for authenticated user', () => {
    expect(menuById(false, 'logout')!.glyph).toBe('↩')
  })

  it('logout item is enabled', () => {
    expect(menuById(false, 'logout')!.enabled).toBe(true)
  })

  it('no "auth" item exists for authenticated user', () => {
    expect(menuById(false, 'auth')).toBeUndefined()
  })
})

// ── Glyph contract ────────────────────────────────────────────────────────────

describe('buildMenuItems — glyph contract (no Lucide, typographic only)', () => {
  const authItems = buildMenuItems(true)
  const validGlyphs = ['◈', '⬡', '▲', '◎', '?', '⇢', '→', '↩']

  it('all glyphs are typographic characters (not icon component names)', () => {
    for (const item of authItems) {
      expect(validGlyphs).toContain(item.glyph)
    }
  })
})

// ── No-badge contract for enabled authed items ─────────────────────────────────

describe('buildMenuItems — no spurious badges on authed items', () => {
  const authedItems = buildMenuItems(false)

  it('portfolio has no badge when authenticated', () => {
    expect(authedItems.find((i) => i.id === 'portfolio')!.badge).toBeUndefined()
  })

  it('credits has no badge when authenticated', () => {
    expect(authedItems.find((i) => i.id === 'credits')!.badge).toBeUndefined()
  })

  it('billing has no badge when authenticated', () => {
    expect(authedItems.find((i) => i.id === 'billing')!.badge).toBeUndefined()
  })

  it('settings has no badge when authenticated', () => {
    expect(authedItems.find((i) => i.id === 'settings')!.badge).toBeUndefined()
  })

  it('help has no badge', () => {
    expect(authedItems.find((i) => i.id === 'help')!.badge).toBeUndefined()
  })
})
