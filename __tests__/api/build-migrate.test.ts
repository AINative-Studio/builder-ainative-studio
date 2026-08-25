import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #49 — POST /api/build/migrate: guest → real-account migration.
 *
 * Safety properties under test:
 *   - anonymous / guest sessions are rejected (401) — no real account to migrate into,
 *   - the owner email comes from the SERVER session ONLY (a body-supplied email is ignored),
 *   - the slug list is normalized (trimmed, de-duped is delegated) and capped,
 *   - a real account's slugs are handed to migrateGuestCompanies and its summary returned.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  migrateGuestCompanies: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({ migrateGuestCompanies: h.migrateGuestCompanies }))

import { POST } from '@/app/api/build/migrate/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

describe('POST /api/build/migrate (#49)', () => {
  beforeEach(() => {
    h.auth.mockReset()
    h.migrateGuestCompanies.mockReset()
    h.migrateGuestCompanies.mockResolvedValue({ migrated: [], skipped: [] })
  })

  it('401 when there is no session', async () => {
    h.auth.mockResolvedValue(null)
    const res = await POST(req({ slugs: ['acme'] }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(h.migrateGuestCompanies).not.toHaveBeenCalled()
  })

  it('401 for a GUEST session (no durable account to migrate into)', async () => {
    h.auth.mockResolvedValue({ user: { email: 'guest-x@example.com', type: 'guest' } })
    const res = await POST(req({ slugs: ['acme'] }))
    expect(res.status).toBe(401)
    expect(h.migrateGuestCompanies).not.toHaveBeenCalled()
  })

  it('migrates for a real account using the SESSION email (ignores body email)', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@acme.com', type: 'ainative' } })
    h.migrateGuestCompanies.mockResolvedValue({ migrated: ['acme'], skipped: [] })

    const res = await POST(req({ slugs: ['acme', 'beta'], email: 'attacker@evil.com' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, migrated: ['acme'], skipped: [] })

    // Called with the session email, NOT the body-supplied one.
    const [slugsArg, emailArg] = h.migrateGuestCompanies.mock.calls[0]
    expect(emailArg).toBe('founder@acme.com')
    expect(slugsArg).toEqual(['acme', 'beta'])
  })

  it('accepts a single { slug } and normalizes/trims it', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@acme.com', type: 'ainative' } })
    h.migrateGuestCompanies.mockResolvedValue({ migrated: ['acme'], skipped: [] })
    await POST(req({ slug: '  acme  ' }))
    const [slugsArg] = h.migrateGuestCompanies.mock.calls[0]
    expect(slugsArg).toEqual(['acme'])
  })

  it('returns an empty result (no migration call) when no slugs are given', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@acme.com', type: 'ainative' } })
    const res = await POST(req({}))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, migrated: [], skipped: [] })
    expect(h.migrateGuestCompanies).not.toHaveBeenCalled()
  })

  it('caps the batch at 25 slugs', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@acme.com', type: 'ainative' } })
    const many = Array.from({ length: 40 }, (_, i) => `co-${i}`)
    await POST(req({ slugs: many }))
    const [slugsArg] = h.migrateGuestCompanies.mock.calls[0]
    expect(slugsArg.length).toBe(25)
  })

  it('still returns ok with skipped=slugs when migrateGuestCompanies rejects', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@acme.com', type: 'ainative' } })
    h.migrateGuestCompanies.mockRejectedValue(new Error('zerodb down'))
    const res = await POST(req({ slugs: ['acme'] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.skipped).toEqual(['acme'])
  })
})
