import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #375 (epic #371, closes #369) — real mocked-dependency tests proving the
 * standards gate actually consumes a REAL coverage number from #372's
 * runner, instead of only checking "does a test file exist" (the gap #369
 * found). The existing committee-pr-gate.test.ts only asserts literal object
 * shapes without calling the real functions — this file calls the real
 * runStandardsGate/measurePRCoverage with every I/O boundary mocked.
 */

const h = vi.hoisted(() => ({
  configured: vi.fn(() => true),
  getPRChangedFilesFetch: vi.fn(),
  postReviewFetch: vi.fn(),
  fetchRepoFiles: vi.fn(),
  runCoverage: vi.fn(),
}))

vi.mock('@/lib/build/coverage-runner', () => ({ runCoverage: h.runCoverage }))

// gitea-client is mocked selectively: configured()/fetchRepoFiles are
// replaced, but findPRByHead/taskBranchName (unused here) stay real-shaped
// via vi.importActual so other exports from the module aren't broken for
// any other code path that might import from the same mocked module.
vi.mock('@/lib/git/gitea-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/git/gitea-client')>('@/lib/git/gitea-client')
  return {
    ...actual,
    configured: h.configured,
    fetchRepoFiles: h.fetchRepoFiles,
  }
})

import { runStandardsGate } from '@/lib/git/committee-pr-gate'

beforeEach(() => {
  h.configured.mockReturnValue(true)
  h.fetchRepoFiles.mockReset()
  h.runCoverage.mockReset()
  // getPRChangedFiles / postPRReview hit global fetch directly (not through
  // gitea-client) — stub global fetch for those two calls.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/pulls/') && String(url).endsWith('/files')) {
      return { ok: true, json: async () => [{ filename: 'app/page.tsx' }, { filename: 'app/page.test.tsx' }] }
    }
    if (String(url).includes('/reviews')) {
      return { ok: true, json: async () => ({ id: 1 }) }
    }
    return { ok: false }
  }))
})

describe('runStandardsGate — real coverage wiring (#375)', () => {
  it('passes a REAL coverage number into the standards check when headRef is supplied and coverage is measurable', async () => {
    h.fetchRepoFiles.mockResolvedValue({ 'app/page.tsx': 'x' })
    h.runCoverage.mockResolvedValue({ coveragePercent: 91, testable: true, passed: true })

    const result = await runStandardsGate({ org: 'ws-1', repo: 'acme', prNumber: 1, headRef: 'task/t_1' })

    expect(h.fetchRepoFiles).toHaveBeenCalledWith('ws-1', 'acme', 'task/t_1')
    expect(h.runCoverage).toHaveBeenCalledWith({ 'app/page.tsx': 'x' })
    // A high real coverage number + a matching test file → standards pass.
    expect(result.ok).toBe(true)
    expect(result.verdict).toBe('approve')
  })

  it('rejects when the REAL coverage number is below the 80% floor', async () => {
    h.fetchRepoFiles.mockResolvedValue({ 'app/page.tsx': 'x' })
    h.runCoverage.mockResolvedValue({ coveragePercent: 40, testable: true, passed: true })

    const result = await runStandardsGate({ org: 'ws-1', repo: 'acme', prNumber: 1, headRef: 'task/t_1' })

    expect(result.ok).toBe(false)
    expect(result.verdict).toBe('request-changes')
    expect(result.details).toMatch(/40/)
  })

  it('skips the coverage check (does not fabricate 0%) when the app has no test suite', async () => {
    h.fetchRepoFiles.mockResolvedValue({ 'app/page.tsx': 'x' })
    h.runCoverage.mockResolvedValue({ coveragePercent: null, testable: false, passed: false })

    const result = await runStandardsGate({ org: 'ws-1', repo: 'acme', prNumber: 1, headRef: 'task/t_1' })

    // No coverage check ran at all (testable:false → coverage stays
    // undefined) — the gate falls back to its other checks (AI attribution,
    // test-file-exists), which still pass here, so the gate isn't blocked
    // by an app that genuinely has no tests yet.
    expect(result.ok).toBe(true)
  })

  it('never fabricates a coverage number when the repo state cannot be fetched', async () => {
    h.fetchRepoFiles.mockResolvedValue(null)

    const result = await runStandardsGate({ org: 'ws-1', repo: 'acme', prNumber: 1, headRef: 'task/t_1' })

    expect(h.runCoverage).not.toHaveBeenCalled()
    // Falls back to the non-coverage checks rather than failing outright.
    expect(result.ok).toBe(true)
  })

  it('preserves existing behavior (no coverage check at all) when headRef is not supplied — backward compatible', async () => {
    const result = await runStandardsGate({ org: 'ws-1', repo: 'acme', prNumber: 1 })

    expect(h.fetchRepoFiles).not.toHaveBeenCalled()
    expect(h.runCoverage).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  it('never lets a coverage-measurement error crash the whole gate', async () => {
    h.fetchRepoFiles.mockRejectedValue(new Error('gitea timeout'))

    const result = await runStandardsGate({ org: 'ws-1', repo: 'acme', prNumber: 1, headRef: 'task/t_1' })

    expect(result.ok).toBe(true) // falls back gracefully, not a thrown exception
  })
})
