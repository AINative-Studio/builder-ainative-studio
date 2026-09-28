import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #875 — coverage-runner.ts's SANDBOXED execution path, with
 * lib/build/mars-sandbox mocked (no real DigitalOcean sessions created).
 * Covers: sandboxed happy path is chosen when mars.configured() is true,
 * the exact FileMap -> tar -> upload -> exec -> download sequence, session
 * teardown always runs, and the fall-back-to-local behavior when the
 * sandbox itself errors.
 *
 * The UNSANDBOXED (mars.configured() === false) behavior is already fully
 * covered by the pre-existing coverage-runner.test.ts (pure logic) and
 * coverage-runner.integration.test.ts (real local subprocess) — deliberately
 * not duplicated here.
 */

const h = vi.hoisted(() => ({
  configured: vi.fn(),
  createSandboxSession: vi.fn(),
  uploadArchive: vi.fn(),
  execInSandbox: vi.fn(),
  downloadFile: vi.fn(),
  removeSandboxSession: vi.fn(),
}))

vi.mock('@/lib/build/mars-sandbox', () => h)

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.configured.mockReturnValue(true)
  h.createSandboxSession.mockResolvedValue({ sessionId: 'sess-abc', sandboxId: 'sandbox-abc', status: 'SESSION_STATUS_READY' })
  h.uploadArchive.mockResolvedValue(undefined)
  h.removeSandboxSession.mockResolvedValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const PASSING_APP = {
  'package.json': JSON.stringify({
    name: 'fixture',
    scripts: { test: 'vitest run --coverage' },
    devDependencies: { vitest: '3.2.4' },
  }),
  'math.js': 'export function add(a,b){return a+b}',
}

describe('runCoverage — sandboxed path (mars-sandbox mocked)', () => {
  it('uses the sandbox when mars.configured() is true: creates a session, uploads, execs install+coverage-dep+test, downloads summary, tears down', async () => {
    h.execInSandbox
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1000 }) // npm install
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 500 })  // coverage-v8 install
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'PASS', stderr: '', timedOut: false, durationMs: 300 }) // test run
    h.downloadFile.mockResolvedValue(Buffer.from(JSON.stringify({ total: { statements: { pct: 92.5 } } })))

    const { runCoverage } = await import('@/lib/build/coverage-runner')
    const result = await runCoverage(PASSING_APP)

    expect(result).toEqual({
      coveragePercent: 92.5,
      testable: true,
      passed: true,
      reason: undefined,
    })
    expect(h.createSandboxSession).toHaveBeenCalledTimes(1)
    expect(h.uploadArchive).toHaveBeenCalledWith('sess-abc', 'app', expect.any(Buffer))
    expect(h.execInSandbox).toHaveBeenCalledTimes(3)
    // Exact argv shapes matter — these are what actually runs as root cause
    // verification, not an approximation.
    expect(h.execInSandbox.mock.calls[0][1]).toEqual(['npm', 'install', '--no-audit', '--no-fund'])
    expect(h.execInSandbox.mock.calls[1][1]).toEqual(['npm', 'install', '--no-audit', '--no-fund', '--no-save', '@vitest/coverage-v8@3.2.4'])
    expect(h.execInSandbox.mock.calls[2][1]).toEqual([
      'npx', 'vitest', 'run', '--coverage',
      '--coverage.reportsDirectory=.coverage-output',
      '--coverage.reporter=json-summary',
    ])
    expect(h.downloadFile).toHaveBeenCalledWith('sess-abc', 'app/.coverage-output/coverage-summary.json')
    // Teardown must run even on success.
    expect(h.removeSandboxSession).toHaveBeenCalledWith('sess-abc')
  })

  it('tears the session down even when the test run fails (passed:false)', async () => {
    h.execInSandbox
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1000 })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 500 })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'FAIL', timedOut: false, durationMs: 300 })
    h.downloadFile.mockResolvedValue(Buffer.from(JSON.stringify({ total: { statements: { pct: 10 } } })))

    const { runCoverage } = await import('@/lib/build/coverage-runner')
    const result = await runCoverage(PASSING_APP)

    expect(result.passed).toBe(false)
    expect(result.coveragePercent).toBe(10)
    expect(result.reason).toMatch(/exited with code 1/)
    expect(h.removeSandboxSession).toHaveBeenCalledWith('sess-abc')
  })

  it('tears the session down and returns an honest reason when npm install fails inside the sandbox', async () => {
    h.execInSandbox.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'ENOTFOUND', timedOut: false, durationMs: 200 })

    const { runCoverage } = await import('@/lib/build/coverage-runner')
    const result = await runCoverage(PASSING_APP)

    expect(result.passed).toBe(false)
    expect(result.coveragePercent).toBeNull()
    expect(result.reason).toMatch(/npm install failed/)
    expect(h.removeSandboxSession).toHaveBeenCalledWith('sess-abc')
    // Never got to the test-run step.
    expect(h.execInSandbox).toHaveBeenCalledTimes(1)
  })

  it('never fabricates a pass when coverage-summary.json never downloads (null, not 0 or 100)', async () => {
    h.execInSandbox
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1000 })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 500 })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 300 })
    h.downloadFile.mockResolvedValue(null)

    const { runCoverage } = await import('@/lib/build/coverage-runner')
    const result = await runCoverage(PASSING_APP)

    expect(result.coveragePercent).toBeNull()
    expect(result.passed).toBe(true) // exit 0 still means the run passed; just no coverage number
  })

  it('falls back to LOCAL execution for this run when the sandbox itself throws (session creation failure)', async () => {
    h.createSandboxSession.mockRejectedValue(new Error('mars createSandboxSession failed: 503 service unavailable'))

    const { runCoverage } = await import('@/lib/build/coverage-runner')
    // No test framework installed locally for this fixture beyond vitest
    // itself (already a devDependency of the repo), so the local fallback
    // genuinely runs npm install + vitest — same as the pre-existing
    // integration test's PASSING_APP fixture.
    const result = await runCoverage(PASSING_APP, { timeoutMs: 60_000 })

    expect(h.createSandboxSession).toHaveBeenCalledTimes(1)
    // Session was never created, so nothing to tear down.
    expect(h.removeSandboxSession).not.toHaveBeenCalled()
    // The local fallback ran for real — testable stays true either way.
    expect(result.testable).toBe(true)
  }, 30_000)

  it('never leaks a session when execInSandbox itself throws mid-run', async () => {
    h.execInSandbox.mockRejectedValue(new Error('mars execInSandbox failed: 500 internal error'))

    const { runCoverage } = await import('@/lib/build/coverage-runner')
    await runCoverage(PASSING_APP, { timeoutMs: 60_000 })

    // Teardown must have been attempted even though exec blew up.
    expect(h.removeSandboxSession).toHaveBeenCalledWith('sess-abc')
  }, 30_000)
})
