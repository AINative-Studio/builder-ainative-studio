import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Same convention as __tests__/lib/guest-user-fallback.test.ts: dotenv's
// config() re-reads .env at module load and can silently repopulate
// process.env.POSTGRES_URL across vi.resetModules() + dynamic import().
// Stub it so deleting POSTGRES_URL in a test actually sticks.
vi.mock('dotenv', () => ({ config: () => ({}) }))

// Never let a test accidentally construct a real postgres TCP client.
const mockPostgresClient = { __mockPostgresClient: true }
const postgresFactory = vi.fn((..._args: any[]) => mockPostgresClient)
vi.mock('postgres', () => ({
  default: (...args: any[]) => postgresFactory(...args),
}))

const mockDrizzleInstance = { __mockDrizzleInstance: true }
const drizzleFactory = vi.fn((..._args: any[]) => mockDrizzleInstance)
vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: (...args: any[]) => drizzleFactory(...args),
}))

describe('lib/db/connection', () => {
  const origPostgresUrl = process.env.POSTGRES_URL

  beforeEach(() => {
    vi.resetModules()
    postgresFactory.mockClear()
    drizzleFactory.mockClear()
  })

  afterEach(() => {
    if (origPostgresUrl === undefined) delete process.env.POSTGRES_URL
    else process.env.POSTGRES_URL = origPostgresUrl
  })

  it('exports null (both default and named) when POSTGRES_URL is not set', async () => {
    delete process.env.POSTGRES_URL
    const mod = await import('@/lib/db/connection')
    expect(mod.default).toBeNull()
    expect(mod.db).toBeNull()
    expect(postgresFactory).not.toHaveBeenCalled()
    expect(drizzleFactory).not.toHaveBeenCalled()
  })

  it('initializes a drizzle client (both default and named export) when POSTGRES_URL is set', async () => {
    process.env.POSTGRES_URL = 'postgres://user:pass@localhost:5432/testdb'
    const mod = await import('@/lib/db/connection')

    expect(postgresFactory).toHaveBeenCalledTimes(1)
    expect(postgresFactory).toHaveBeenCalledWith('postgres://user:pass@localhost:5432/testdb')
    expect(drizzleFactory).toHaveBeenCalledTimes(1)
    expect(drizzleFactory).toHaveBeenCalledWith(
      mockPostgresClient,
      expect.objectContaining({ schema: expect.anything() }),
    )

    expect(mod.default).toBe(mockDrizzleInstance)
    expect(mod.db).toBe(mockDrizzleInstance)
  })

  it('does not construct a client when POSTGRES_URL is an empty string (falsy)', async () => {
    process.env.POSTGRES_URL = ''
    const mod = await import('@/lib/db/connection')
    expect(mod.default).toBeNull()
    expect(postgresFactory).not.toHaveBeenCalled()
  })
})
