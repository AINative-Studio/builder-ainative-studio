import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Slug collision handling in register-app. Confirmed live in production:
 * no uniqueness check existed at all — a slug is derived client-side from
 * the founder's chosen company name via a naive lowercase+dash transform,
 * so two unrelated founders naming their company the same thing would
 * silently share/overwrite one registry row.
 *
 * A DIFFERENT chatId already registered under the requested slug is the
 * real collision signal (a genuinely different build session) — the SAME
 * chatId means this is just a regeneration of the founder's own existing
 * build, which must keep its original slug.
 */

const h = vi.hoisted(() => ({
  registerApp: vi.fn(),
  resolveApp: vi.fn(),
  deployPersistent: vi.fn(),
  checkAppReady: vi.fn(),
  resolveStoredApp: vi.fn(),
  checkSeededData: vi.fn(),
  commitRegeneration: vi.fn(),
  provisionCompanyRepo: vi.fn(),
  enrollCompany: vi.fn(),
  isEnrolled: vi.fn(),
  auth: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({ registerApp: h.registerApp, resolveApp: h.resolveApp }))
vi.mock('@/lib/build/deploy', () => ({ deployPersistent: h.deployPersistent }))
vi.mock('@/lib/build/ready-gate', () => ({ checkAppReady: h.checkAppReady, resolveStoredApp: h.resolveStoredApp }))
vi.mock('@/lib/build/seed-check', () => ({ checkSeededData: h.checkSeededData }))
vi.mock('@/lib/git/company-repo', () => ({
  commitRegeneration: h.commitRegeneration,
  provisionCompanyRepo: h.provisionCompanyRepo,
  toFileMapForCommit: (stored: { code: string; files: Record<string, string> | null } | null) => {
    if (!stored) return null
    if (stored.files && Object.keys(stored.files).length > 0) return stored.files
    if (stored.code && stored.code.trim()) return { 'App.tsx': stored.code }
    return null
  },
}))
vi.mock('@/lib/build/instant-db', () => ({ BUILDER_WORKSPACE_ID: 'builder-ws-default' }))
vi.mock('@/lib/build/loop-enrollment', () => ({ enrollCompany: h.enrollCompany, isEnrolled: h.isEnrolled }))

import { POST } from '@/app/api/build/register-app/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

describe('POST /api/build/register-app — slug collision handling', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    h.checkAppReady.mockResolvedValue({ checked: true, ok: true })
    h.deployPersistent.mockResolvedValue({ url: 'https://builder.ainative.studio/build/acme', dnsPointable: false })
    h.resolveStoredApp.mockResolvedValue(null)
    h.registerApp.mockResolvedValue(true)
    h.auth.mockResolvedValue(null)
    h.enrollCompany.mockResolvedValue(true)
    h.isEnrolled.mockResolvedValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers the requested slug as-is when nothing else owns it', async () => {
    h.resolveApp.mockResolvedValue(null)
    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    const json = await res.json()
    expect(json.slug).toBe('acme')
    expect(json.slugChanged).toBeNull()
    expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ slug: 'acme' }))
  })

  it('registers the requested slug as-is on a genuine regeneration (SAME chatId already owns it)', async () => {
    h.resolveApp.mockImplementation(async (slug: string) =>
      slug === 'acme' ? { slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' } : null,
    )
    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme v2', track: 'app' }))
    const json = await res.json()
    expect(json.slug).toBe('acme')
    expect(json.slugChanged).toBeNull()
  })

  it('auto-suffixes to the next free slug on a REAL collision (different chatId already owns it)', async () => {
    h.resolveApp.mockImplementation(async (slug: string) => {
      if (slug === 'dwello') return { slug: 'dwello', chatId: 'someone-elses-chat', name: 'Dwello', track: 'company' }
      return null // dwello-2 is free
    })
    const res = await POST(req({ slug: 'dwello', chatId: 'my-chat', name: 'Dwello', track: 'company' }))
    const json = await res.json()
    expect(json.slug).toBe('dwello-2')
    expect(json.slugChanged).toBe('dwello-2')
    expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ slug: 'dwello-2' }))
    expect(h.deployPersistent).toHaveBeenCalledWith('my-chat', 'dwello-2')
  })

  it('keeps walking the suffix chain until a free one is found', async () => {
    const taken = new Set(['dwello', 'dwello-2', 'dwello-3'])
    h.resolveApp.mockImplementation(async (slug: string) =>
      taken.has(slug) ? { slug, chatId: 'someone-elses-chat' } : null,
    )
    const res = await POST(req({ slug: 'dwello', chatId: 'my-chat', name: 'Dwello', track: 'company' }))
    const json = await res.json()
    expect(json.slug).toBe('dwello-4')
  })

  it('does NOT treat an anonymous existing entry (no ownerEmail) with a different chatId as safe to reuse', async () => {
    // Confirms the fix covers the real production gap even when the earlier
    // registration was anonymous/guest (no ownerEmail at all) — chatId
    // mismatch alone is the correct, sufficient collision signal.
    h.resolveApp.mockImplementation(async (slug: string) =>
      slug === 'shared-name' ? { slug: 'shared-name', chatId: 'anon-chat', ownerEmail: undefined } : null,
    )
    const res = await POST(req({ slug: 'shared-name', chatId: 'my-real-chat', name: 'Shared Name', track: 'app' }))
    const json = await res.json()
    expect(json.slug).toBe('shared-name-2')
  })

  /**
   * Real gap found live (Meridian, 2026-09-10): the slug's own AUTHENTICATED
   * OWNER regenerating their own company (a new chatId every time) got
   * auto-suffixed to "{slug}-2" instead of updating their real, live slug —
   * this route had no way to recognize "this IS the same founder redeploying
   * their own build," only "same chatId as before."
   */
  it('lets the AUTHENTICATED, CONFIRMED owner overwrite their own slug with a new chatId', async () => {
    h.resolveApp.mockImplementation(async (slug: string) =>
      slug === 'meridian'
        ? { slug: 'meridian', chatId: 'old-chat', ownerEmail: 'admin@ainative.studio', name: 'Meridian', track: 'company' }
        : null,
    )
    h.auth.mockResolvedValue({ user: { email: 'admin@ainative.studio' } })
    const res = await POST(req({ slug: 'meridian', chatId: 'new-chat', name: 'Meridian', track: 'company' }))
    const json = await res.json()
    expect(json.slug).toBe('meridian')
    expect(json.slugChanged).toBeNull()
    expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ slug: 'meridian', chatId: 'new-chat' }))
  })

  it('does NOT let a DIFFERENT authenticated user overwrite someone else\'s owned slug', async () => {
    h.resolveApp.mockImplementation(async (slug: string) =>
      slug === 'meridian'
        ? { slug: 'meridian', chatId: 'old-chat', ownerEmail: 'founder@example.com', name: 'Meridian', track: 'company' }
        : null,
    )
    h.auth.mockResolvedValue({ user: { email: 'someone-else@example.com' } })
    const res = await POST(req({ slug: 'meridian', chatId: 'new-chat', name: 'Meridian', track: 'company' }))
    const json = await res.json()
    expect(json.slug).toBe('meridian-2')
    expect(json.slugChanged).toBe('meridian-2')
  })

  it('does NOT let an UNAUTHENTICATED caller overwrite an owned slug, even if they pass a matching email claim elsewhere', async () => {
    h.resolveApp.mockImplementation(async (slug: string) =>
      slug === 'meridian'
        ? { slug: 'meridian', chatId: 'old-chat', ownerEmail: 'admin@ainative.studio', name: 'Meridian', track: 'company' }
        : null,
    )
    h.auth.mockResolvedValue(null) // no session at all
    const res = await POST(req({ slug: 'meridian', chatId: 'new-chat', name: 'Meridian', track: 'company' }))
    const json = await res.json()
    expect(json.slug).toBe('meridian-2')
  })

  it('never fails registration when the collision check itself throws', async () => {
    h.resolveApp.mockRejectedValue(new Error('zerodb timeout'))
    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    // Falls back to the requested slug (fail-open — a broken lookup must
    // never block a real registration).
    expect(json.slug).toBe('acme')
  })
})

// #660: idea is now persisted at registration so a LATER page load (fresh
// tab, bookmark, returning founder) can hydrate it server-side via
// resolve-app instead of only ever trusting client-only reducer state —
// without this, Live.tsx's real-product-generation trigger silently never
// fired for a founder who left and came back.
describe('POST /api/build/register-app — idea persistence (#660)', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    h.checkAppReady.mockResolvedValue({ checked: true, ok: true })
    h.deployPersistent.mockResolvedValue({ url: 'https://builder.ainative.studio/build/ember-box', dnsPointable: false })
    h.resolveStoredApp.mockResolvedValue(null)
    h.registerApp.mockResolvedValue(true)
    h.auth.mockResolvedValue(null)
    h.enrollCompany.mockResolvedValue(true)
    h.isEnrolled.mockResolvedValue(false)
  })

  it('persists a real idea passed on the request', async () => {
    h.resolveApp.mockResolvedValue(null)
    await POST(req({ slug: 'ember-box', chatId: 'chat-1', name: 'Ember Box', track: 'company', idea: 'A hot sauce subscription box' }))
    expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ idea: 'A hot sauce subscription box' }))
  })

  it('carries forward the existing idea on a regeneration call that omits it', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'ember-box', chatId: 'chat-1', name: 'Ember Box', track: 'company', idea: 'A hot sauce subscription box' })
    await POST(req({ slug: 'ember-box', chatId: 'chat-1', name: 'Ember Box v2', track: 'company' }))
    expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ idea: 'A hot sauce subscription box' }))
  })

  it('trims and caps idea length', async () => {
    h.resolveApp.mockResolvedValue(null)
    const longIdea = 'x'.repeat(4000)
    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app', idea: `  ${longIdea}  ` }))
    const call = h.registerApp.mock.calls[0][0]
    expect(call.idea.length).toBe(3000)
    expect(call.idea.startsWith(' ')).toBe(false)
  })
})
