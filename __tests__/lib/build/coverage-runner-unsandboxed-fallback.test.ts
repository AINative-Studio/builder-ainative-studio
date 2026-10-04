import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #917 (closes #875's residual gap): a missing/misconfigured E2B_API_KEY must
 * NEVER silently fall through to the unsandboxed local `spawn()` path — that
 * path runs a founder's own untrusted, LLM-generated test command directly on
 * Builder's production server process. e2b-sandbox.ts's own doc comment on
 * isE2BEnabled() already claims this should "fail closed... never silently
 * run unsandboxed," mirroring isBedrockEnabled()'s pattern in
 * lib/bedrock-client.ts — but coverage-runner.ts's real runCoverage() did the
 * opposite: it fell straight through to spawn() with zero warning logged.
 *
 * Fix direction chosen (see PR body for the full rationale): default to an
 * honest refusal (testable:false, passed:false) when E2B isn't configured,
 * with an explicit, narrowly-named opt-in (ALLOW_UNSANDBOXED_COVERAGE=true)
 * for the legitimate local-dev case where a developer genuinely has no E2B
 * key and still wants to exercise the real subprocess path. The opt-in path
 * ALSO logs a loud, searchable warning — so even the explicit escape hatch
 * never acts silently.
 */

const mockRunSequence = vi.fn()

vi.mock('@/lib/build/e2b-sandbox', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/e2b-sandbox')>('@/lib/build/e2b-sandbox')
  return {
    ...actual,
    runSequenceInE2BSandbox: (...args: any[]) => mockRunSequence(...args),
  }
})

import { runCoverage } from '@/lib/build/coverage-runner'

const PKG_JSON = JSON.stringify({
  scripts: { test: 'vitest run' },
  devDependencies: { vitest: '^3.0.0' },
})

describe('runCoverage — fail-closed when E2B is unconfigured (#917)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('returns an honest refusal (not a fabricated pass/fail) when E2B_API_KEY is absent and no opt-in is set', async () => {
    const result = await runCoverage(
      { 'package.json': PKG_JSON },
      { env: {} as any },
    )

    expect(result).toEqual({
      coveragePercent: null,
      testable: false,
      passed: false,
      reason: 'E2B not configured — sandboxed execution required for untrusted code',
    })
  })

  it('never touches the local spawn() path or the E2B path when refusing', async () => {
    await runCoverage({ 'package.json': PKG_JSON }, { env: {} as any })
    expect(mockRunSequence).not.toHaveBeenCalled()
  })

  it('logs a loud, searchable warning before refusing', async () => {
    await runCoverage({ 'package.json': PKG_JSON }, { env: {} as any })

    expect(errorSpy).toHaveBeenCalled()
    const logged = errorSpy.mock.calls.map((args) => args.join(' ')).join('\n')
    expect(logged).toMatch(/E2B/i)
    expect(logged).toMatch(/unsandboxed|not configured/i)
  })

  it('does NOT refuse when the app has no testable suite at all — "no tests" must still win over the E2B check', async () => {
    // detectTestCommand returning null is an entirely separate, pre-existing
    // code path (no vitest dep / no test script) and must keep its own
    // specific reason regardless of E2B configuration.
    const result = await runCoverage(
      { 'package.json': JSON.stringify({ scripts: {}, dependencies: {} }) },
      { env: {} as any },
    )
    expect(result.reason).toMatch(/no.*coverage-testable/i)
  })

  it('still routes to the real E2B path, unchanged, when E2B_API_KEY IS set', async () => {
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '' },
        { exitCode: 0, stdout: '', stderr: '' },
        { exitCode: 0, stdout: '', stderr: '' },
      ],
      files: { '.coverage-output/coverage-summary.json': '{"total":{"statements":{"pct":92}}}' },
    })

    const result = await runCoverage(
      { 'package.json': PKG_JSON },
      { env: { E2B_API_KEY: 'test-key' } as any },
    )

    expect(mockRunSequence).toHaveBeenCalledOnce()
    expect(result.testable).toBe(true)
    expect(result.coveragePercent).toBe(92)
    // No refusal warning should fire on the happy E2B path.
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('falls back to the real local spawn() path ONLY when the explicit opt-in is set, and logs a loud warning when it does', async () => {
    const result = await runCoverage(
      { 'package.json': PKG_JSON },
      { env: { ALLOW_UNSANDBOXED_COVERAGE: 'true' } as any, timeoutMs: 100 },
    )

    // No real npm/vitest is guaranteed installed in this unit-test env, so we
    // only assert it took the "attempted local execution" branch rather than
    // the instant refusal — i.e. it did NOT return the canned refusal reason.
    expect(result.reason).not.toBe('E2B not configured — sandboxed execution required for untrusted code')
    expect(mockRunSequence).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    const logged = errorSpy.mock.calls.map((args) => args.join(' ')).join('\n')
    expect(logged).toMatch(/unsandboxed/i)
  })

  it('treats any non-"true" value for the opt-in as not opted in (refuses)', async () => {
    const result = await runCoverage(
      { 'package.json': PKG_JSON },
      { env: { ALLOW_UNSANDBOXED_COVERAGE: '0' } as any },
    )
    expect(result.testable).toBe(false)
    expect(result.reason).toBe('E2B not configured — sandboxed execution required for untrusted code')
  })
})
