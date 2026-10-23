import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1202 (Coverage Phase 2) — /api/version, /api/health, /api/auth/guest.
 * Small routes, but each has real branching worth locking down:
 *  - /api/version: SHA env-var fallback order (Railway -> Vercel -> manual -> 'unknown').
 *  - /api/health: liveness vs readiness (?ready=1) status codes, optional
 *    Claude model smoke test (?model=1) folding into readiness, and the
 *    "never fail a liveness probe" catch branch.
 *  - /api/auth/guest: open-redirect guard (relative redirectUrl only; absolute
 *    or missing falls back to /login). Guest sign-in itself is retired.
 */

describe('#1202 GET /api/version', () => {
  const ORIGINAL = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  it('prefers RAILWAY_GIT_COMMIT_SHA when present', async () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = 'railway-sha'
    process.env.VERCEL_GIT_COMMIT_SHA = 'vercel-sha'
    process.env.NEXT_PUBLIC_BUILD_SHA = 'manual-sha'
    const { GET } = await import('@/app/api/version/route')

    const res = GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.commit).toBe('railway-sha')
    expect(body.service).toBe('builder')
  })

  it('falls back to VERCEL_GIT_COMMIT_SHA when Railway is unset', async () => {
    delete process.env.RAILWAY_GIT_COMMIT_SHA
    process.env.VERCEL_GIT_COMMIT_SHA = 'vercel-sha'
    const { GET } = await import('@/app/api/version/route')

    const body = await GET().json()

    expect(body.commit).toBe('vercel-sha')
  })

  it('falls back to "unknown" when no SHA env var is set', async () => {
    delete process.env.RAILWAY_GIT_COMMIT_SHA
    delete process.env.VERCEL_GIT_COMMIT_SHA
    delete process.env.NEXT_PUBLIC_BUILD_SHA
    const { GET } = await import('@/app/api/version/route')

    const body = await GET().json()

    expect(body.commit).toBe('unknown')
  })
})

const monitoring = vi.hoisted(() => ({ monitoring: { checkSystemHealth: vi.fn() } }))
vi.mock('@/lib/monitoring', () => ({ monitoring: monitoring.monitoring }))

const logger = vi.hoisted(() => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: logger.logger }))

const smoketest = vi.hoisted(() => ({ runClaudeModelSmokeTest: vi.fn() }))
vi.mock('@/lib/config/claude-model-smoketest', () => ({
  runClaudeModelSmokeTest: smoketest.runClaudeModelSmokeTest,
}))

describe('#1202 GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('liveness (no ?ready): always 200 even when the system is unhealthy', async () => {
    monitoring.monitoring.checkSystemHealth.mockResolvedValue({
      status: 'unhealthy',
      uptime: 10,
      database: { status: 'down', responseTime: 0 },
      errors: ['db down'],
    })
    const { GET } = await import('@/app/api/health/route')

    const res = await GET(new Request('http://localhost/api/health'))

    expect(res.status).toBe(200)
  })

  it('readiness (?ready=1): 503 when the system is unhealthy', async () => {
    monitoring.monitoring.checkSystemHealth.mockResolvedValue({
      status: 'unhealthy',
      uptime: 10,
      database: { status: 'down', responseTime: 0 },
      errors: ['db down'],
    })
    const { GET } = await import('@/app/api/health/route')

    const res = await GET(new Request('http://localhost/api/health?ready=1'))

    expect(res.status).toBe(503)
  })

  it('readiness (?ready=1): 200 when the system is healthy', async () => {
    monitoring.monitoring.checkSystemHealth.mockResolvedValue({
      status: 'healthy',
      uptime: 10,
      database: { status: 'up', responseTime: 5 },
      errors: [],
    })
    const { GET } = await import('@/app/api/health/route')

    const res = await GET(new Request('http://localhost/api/health?ready=1'))

    expect(res.status).toBe(200)
  })

  it('?ready=1&model=1: a failed Claude smoke test also forces 503', async () => {
    monitoring.monitoring.checkSystemHealth.mockResolvedValue({
      status: 'healthy',
      uptime: 10,
      database: { status: 'up', responseTime: 5 },
      errors: [],
    })
    smoketest.runClaudeModelSmokeTest.mockResolvedValue({ ok: false, provider: 'bedrock', error: 'timeout' })
    const { GET } = await import('@/app/api/health/route')

    const res = await GET(new Request('http://localhost/api/health?ready=1&model=1'))

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.checks.claudeModel.status).toBe('unhealthy')
  })

  it('?model=1 without ?ready: smoke test result is reported but does not force 503', async () => {
    monitoring.monitoring.checkSystemHealth.mockResolvedValue({
      status: 'healthy',
      uptime: 10,
      database: { status: 'up', responseTime: 5 },
      errors: [],
    })
    smoketest.runClaudeModelSmokeTest.mockResolvedValue({ ok: false, provider: 'bedrock', error: 'timeout' })
    const { GET } = await import('@/app/api/health/route')

    const res = await GET(new Request('http://localhost/api/health?model=1'))

    expect(res.status).toBe(200)
  })

  it('never fails the liveness probe: returns 200 even when checkSystemHealth throws', async () => {
    monitoring.monitoring.checkSystemHealth.mockRejectedValue(new Error('monitoring crashed'))
    const { GET } = await import('@/app/api/health/route')

    const res = await GET(new Request('http://localhost/api/health'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('unhealthy')
  })
})

describe('#1202 GET /api/auth/guest', () => {
  // next/navigation's redirect() throws a sentinel whose digest encodes the
  // destination as "NEXT_REDIRECT;<type>;<url>;<status>" — asserting on it
  // directly (rather than just "it threw") is what actually exercises the
  // open-redirect guard branch instead of merely confirming a redirect happened.
  async function redirectDigest(url: string): Promise<string> {
    const { GET } = await import('@/app/api/auth/guest/route')
    try {
      await GET(new Request(url))
    } catch (e: any) {
      return e.digest as string
    }
    throw new Error('expected GET to call redirect()')
  }

  it('redirects to the relative redirectUrl when one is provided', async () => {
    const digest = await redirectDigest('http://localhost/api/auth/guest?redirectUrl=/build')
    expect(digest).toContain(';/build;')
  })

  it('falls back to /login when redirectUrl is an absolute URL (open-redirect guard)', async () => {
    const digest = await redirectDigest(
      'http://localhost/api/auth/guest?redirectUrl=https://evil.example.com'
    )
    expect(digest).toContain(';/login;')
    expect(digest).not.toContain('evil.example.com')
  })

  it('falls back to /login when no redirectUrl is provided', async () => {
    const digest = await redirectDigest('http://localhost/api/auth/guest')
    expect(digest).toContain(';/login;')
  })
})
