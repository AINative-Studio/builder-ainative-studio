import { describe, it, expect, vi, beforeEach } from 'vitest'

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

describe('runCoverage — E2B-isolated path (#875)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes to E2B when E2B_API_KEY is set, and never touches the local subprocess path', async () => {
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
    expect(result).toEqual({
      coveragePercent: 92,
      testable: true,
      passed: true,
      reason: undefined,
    })
  })

  it('reports a distinct reason when npm install fails inside the sandbox', async () => {
    mockRunSequence.mockResolvedValue({
      commandResults: [{ exitCode: 1, stdout: '', stderr: 'ENOTFOUND' }],
      files: {},
    })

    const result = await runCoverage(
      { 'package.json': PKG_JSON },
      { env: { E2B_API_KEY: 'test-key' } as any },
    )

    expect(result.passed).toBe(false)
    expect(result.coveragePercent).toBeNull()
    expect(result.reason).toMatch(/npm install failed/)
    expect(result.reason).toMatch(/E2B sandbox/)
  })

  it('reports a distinct reason when the coverage-v8 install step fails', async () => {
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '' },
        { exitCode: 1, stdout: '', stderr: 'package not found' },
      ],
      files: {},
    })

    const result = await runCoverage(
      { 'package.json': PKG_JSON },
      { env: { E2B_API_KEY: 'test-key' } as any },
    )

    expect(result.reason).toMatch(/@vitest\/coverage-v8 install failed/)
  })

  it('surfaces a distinct reason when the sandbox itself cannot be created', async () => {
    mockRunSequence.mockResolvedValue({
      commandResults: [],
      files: {},
      sandboxError: 'invalid API key',
    })

    const result = await runCoverage(
      { 'package.json': PKG_JSON },
      { env: { E2B_API_KEY: 'bad-key' } as any },
    )

    expect(result.passed).toBe(false)
    expect(result.reason).toMatch(/E2B sandbox unavailable/)
    expect(result.reason).toMatch(/invalid API key/)
  })

  it('reports a timeout distinctly from a non-zero exit', async () => {
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '' },
        { exitCode: 0, stdout: '', stderr: '' },
        { exitCode: null, stdout: '', stderr: 'timed out', timedOut: true },
      ],
      files: {},
    })

    const result = await runCoverage(
      { 'package.json': PKG_JSON },
      { env: { E2B_API_KEY: 'test-key' } as any },
    )

    expect(result.reason).toMatch(/timed out/)
  })

  it('does NOT route to E2B when E2B_API_KEY is absent', async () => {
    // #917: a missing E2B_API_KEY (and no ALLOW_UNSANDBOXED_COVERAGE opt-in)
    // now returns an honest refusal rather than falling through to the local
    // spawn() path — see coverage-runner-unsandboxed-fallback.test.ts for the
    // full behavior. This test only asserts runSequenceInE2BSandbox (the E2B
    // path) was never called.
    await runCoverage(
      { 'package.json': PKG_JSON },
      { env: {} as any, timeoutMs: 100 },
    )

    expect(mockRunSequence).not.toHaveBeenCalled()
  })
})
