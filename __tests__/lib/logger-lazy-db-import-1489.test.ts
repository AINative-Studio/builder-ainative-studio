import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * #1489 — lib/logger.ts used to STATICALLY import the drizzle ORM chain
 * (`db` from ./db/connection plus the 1343-line ./db/schema), even though the
 * only consumer of either is persistError(), which no-ops entirely unless
 * NODE_ENV === 'production' AND the level is error/fatal.
 *
 * Because logger.ts is imported by a very large share of this repo's server
 * modules (app/api/build/ask/route.ts reaches it via
 * lib/agent/zeromemory.ts -> lib/logger.ts), every one of those importers paid
 * the full cost of Vite resolving and transforming `drizzle-orm/postgres-js`
 * + schema.ts at module load. Measured on the #1489 repro: importing
 * drizzle-orm/postgres-js alone is ~1.9s, the dominant term in the ~4s import
 * of the ask route, and the reason
 * __tests__/api/build-ask-project-resolution.test.ts flaked against its
 * 5000ms timeout under full-suite contention.
 *
 * NOTE on the original issue's diagnosis: the `🗄️  Using PostgreSQL database`
 * line in stdout is a red herring. `postgres(url)` does not open a TCP
 * connection — the driver connects lazily on first query — and deleting
 * POSTGRES_URL (so lib/db/connection.ts's eager block is skipped outright)
 * left the route import time unchanged (~4.2s either way). The cost is module
 * graph transform, not real Postgres I/O.
 *
 * The first test below is a STATIC SOURCE assertion rather than a runtime
 * spy: once the import is lazy, a runtime spy on the postgres/drizzle
 * factories cannot distinguish "module never loaded" from "module loaded but
 * factory not called", and asserting on wall-clock time would be flaky under
 * suite contention. Guarding the source text is what actually prevents the
 * static import from being reintroduced.
 */

const LOGGER_PATH = resolve(__dirname, '../../lib/logger.ts')

const h = vi.hoisted(() => ({ insert: vi.fn() }))

/**
 * persistError() is fire-and-forget (the logger never awaits it), and it now
 * performs a dynamic import before touching the DB, so the write lands a few
 * microtask/module-load ticks after the logger.error() call returns. Poll
 * instead of sleeping a fixed amount, so the test is deterministic rather
 * than racing a hard-coded delay.
 */
async function waitFor(cond: () => boolean, timeoutMs = 5000) {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) return false
    await new Promise((r) => setTimeout(r, 5))
  }
  return true
}


describe('lib/logger lazy DB import (#1489)', () => {
  const origNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    vi.resetModules()
    h.insert.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.doUnmock('@/lib/db/connection')
    if (origNodeEnv === undefined) delete (process.env as any).NODE_ENV
    else (process.env as any).NODE_ENV = origNodeEnv
  })

  it('does not STATICALLY import the drizzle/postgres chain', () => {
    const src = readFileSync(LOGGER_PATH, 'utf8')

    // Strip comments so the explanatory doc comment in logger.ts (which names
    // these modules) cannot satisfy or break the assertion.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

    const staticImports = [...code.matchAll(/^\s*import\s[\s\S]*?from\s*['"]([^'"]+)['"]/gm)].map(
      (m) => m[1],
    )

    expect(staticImports).not.toContain('./db/connection')
    expect(staticImports).not.toContain('./db/schema')
    expect(staticImports).not.toContain('drizzle-orm')
    expect(staticImports).not.toContain('drizzle-orm/postgres-js')
    expect(staticImports).not.toContain('postgres')

    // And nothing drizzle/postgres-shaped sneaks in under another specifier.
    expect(staticImports.filter((s) => /drizzle|(^|\/)postgres|db\/(connection|schema)/.test(s)))
      .toEqual([])

    // Sanity: the file really does still import its non-DB deps statically,
    // so a typo'd/empty parse cannot make this test vacuously pass.
    expect(staticImports).toContain('pino')
  })

  it('still exports a usable logger whose non-error levels work', async () => {
    const { logger } = await import('@/lib/logger')

    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.fatal).toBe('function')
    expect(() => logger.info('hello', { path: '/x' })).not.toThrow()
  })

  it('does not persist outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.doMock('@/lib/db/connection', () => ({
      default: { insert: h.insert },
      db: { insert: h.insert },
    }))

    const { logger } = await import('@/lib/logger')
    logger.error('boom', new Error('boom'))
    await new Promise((r) => setTimeout(r, 10))

    expect(h.insert).not.toHaveBeenCalled()
  })

  it('really persists an error row in production (lazy load happens on demand)', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const values = vi.fn(async (_row: Record<string, unknown>) => undefined)
    h.insert.mockReturnValue({ values })
    vi.doMock('@/lib/db/connection', () => ({
      default: { insert: h.insert },
      db: { insert: h.insert },
    }))

    const { logger } = await import('@/lib/logger')

    // Importing the logger alone must not have reached for the DB.
    expect(h.insert).not.toHaveBeenCalled()

    logger.error('kaboom', Object.assign(new Error('kaboom'), { code: 'E_X' }), {
      path: '/api/thing',
      userId: 'u1',
    })
    expect(await waitFor(() => h.insert.mock.calls.length > 0)).toBe(true)

    expect(h.insert).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledTimes(1)
    const row = values.mock.calls[0][0] as any
    expect(row.level).toBe('error')
    expect(row.message).toBe('kaboom')
    expect(row.error_type).toBe('Error')
    expect(row.endpoint).toBe('/api/thing')
    expect(row.user_id).toBe('u1')
  })

  it('swallows a DB failure during persistence rather than throwing at the call site', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    h.insert.mockImplementation(() => {
      throw new Error('db down')
    })
    vi.doMock('@/lib/db/connection', () => ({
      default: { insert: h.insert },
      db: { insert: h.insert },
    }))

    const { logger } = await import('@/lib/logger')

    expect(() => logger.fatal('dead', new Error('dead'))).not.toThrow()
    expect(await waitFor(() => h.insert.mock.calls.length > 0)).toBe(true)
    expect(h.insert).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the DB is unconfigured (db export is null) in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.doMock('@/lib/db/connection', () => ({ default: null, db: null }))

    const { logger } = await import('@/lib/logger')

    expect(() => logger.error('no db', new Error('no db'))).not.toThrow()
    await new Promise((r) => setTimeout(r, 10))
  })
})
