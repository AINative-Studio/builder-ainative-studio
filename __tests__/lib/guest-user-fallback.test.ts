import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// queries.ts imports the Next.js 'server-only' guard, which vitest can't resolve.
vi.mock('server-only', () => ({}))

// REAL BUG (found 2026-10-04): lib/db/connection.ts calls dotenv's config() at
// module load, which re-reads .env and silently REPOPULATES process.env.POSTGRES_URL
// even after a test deletes it — because vi.resetModules() + a fresh dynamic
// import() re-runs connection.ts from scratch each time. With POSTGRES_URL back,
// connection.ts tries to construct a REAL postgres() client against whatever is in
// .env, and createGuestUser()'s own correct early-return (queries.ts:94) never gets
// a chance to run — every test timed out at 5s (a real TCP attempt, not a hang in
// product code). Stubbing dotenv here is what actually lets the test exercise the
// no-DB-configured path it claims to cover.
vi.mock('dotenv', () => ({ config: () => ({}) }))

/**
 * createGuestUser must NOT throw when Postgres is unreachable — throwing broke
 * the entire auth callback and locked anonymous visitors out of the product
 * (#100). It should degrade to an ephemeral guest identity.
 */
describe('createGuestUser graceful fallback (#100)', () => {
  const orig = process.env.POSTGRES_URL

  beforeEach(() => {
    vi.resetModules()
    delete process.env.POSTGRES_URL
  })
  afterEach(() => {
    if (orig === undefined) delete process.env.POSTGRES_URL
    else process.env.POSTGRES_URL = orig
  })

  it('returns an ephemeral guest when POSTGRES_URL is unset (no DB attempt)', async () => {
    const { createGuestUser } = await import('@/lib/db/queries')
    const [guest] = await createGuestUser()
    expect(guest).toBeTruthy()
    expect(guest.email).toMatch(/^guest-.*@example\.com$/)
    expect(guest.is_active).toBe(true)
    expect((guest as any).workspace_id).toBeTruthy()
  })

  it('never throws — always yields a usable guest identity', async () => {
    const { createGuestUser } = await import('@/lib/db/queries')
    await expect(createGuestUser()).resolves.toBeTruthy()
  })

  it('each ephemeral guest gets a unique id/email', async () => {
    const { createGuestUser } = await import('@/lib/db/queries')
    const [a] = await createGuestUser()
    const [b] = await createGuestUser()
    expect(a.id).not.toBe(b.id)
    expect(a.email).not.toBe(b.email)
  })
})
