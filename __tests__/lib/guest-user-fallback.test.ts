import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// queries.ts imports the Next.js 'server-only' guard, which vitest can't resolve.
vi.mock('server-only', () => ({}))

/**
 * createGuestUser must NOT throw when Postgres is unreachable — throwing broke
 * the entire auth callback and locked anonymous visitors out of the product
 * (#100). It should degrade to an ephemeral guest identity.
 */
describe('createGuestUser graceful fallback (#100)', () => {
  const orig = process.env.POSTGRES_URL

  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    if (orig === undefined) delete process.env.POSTGRES_URL
    else process.env.POSTGRES_URL = orig
  })

  it('returns an ephemeral guest when POSTGRES_URL is unset (no DB attempt)', async () => {
    delete process.env.POSTGRES_URL
    const { createGuestUser } = await import('@/lib/db/queries')
    const [guest] = await createGuestUser()
    expect(guest).toBeTruthy()
    expect(guest.email).toMatch(/^guest-.*@example\.com$/)
    expect(guest.is_active).toBe(true)
    expect((guest as any).workspace_id).toBeTruthy()
  })

  it('never throws — always yields a usable guest identity', async () => {
    delete process.env.POSTGRES_URL
    const { createGuestUser } = await import('@/lib/db/queries')
    await expect(createGuestUser()).resolves.toBeTruthy()
  })

  it('each ephemeral guest gets a unique id/email', async () => {
    delete process.env.POSTGRES_URL
    const { createGuestUser } = await import('@/lib/db/queries')
    const [a] = await createGuestUser()
    const [b] = await createGuestUser()
    expect(a.id).not.toBe(b.id)
    expect(a.email).not.toBe(b.email)
  })
})
