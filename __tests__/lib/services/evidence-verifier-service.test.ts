/**
 * Evidence Verifier Service Tests (lib/services path)
 *
 * Complements __tests__/services/evidence-verifier.service.test.ts by
 * specifically targeting the loadRecentEvidence() DB-failure branch
 * (catch block, lines 172-175) which that suite did not exercise, plus
 * additional edge cases around null/undefined optional inputs and
 * extractCoverage's branches. All DB access goes through `@/lib/db`,
 * which is mocked here per house style (see
 * __tests__/lib/services/rule-enforcement-db-service.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Evidence, EvidenceType } from '@/lib/types/evidence'

// --- DB mock --------------------------------------------------------------
// Chainable builder whose terminal `.limit()` call is swapped per-test so we
// can simulate both a successful query and a thrown DB error.
const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))
vi.mock('@/lib/db/schema', () => ({
  evidence: { user_id: 'user_id', git_branch: 'git_branch', created_at: 'created_at' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ op: 'eq', a, b })),
  and: vi.fn((...args) => ({ op: 'and', args })),
  desc: vi.fn((col) => ({ op: 'desc', col })),
}))

import {
  EvidenceVerifierService,
  getEvidenceVerifierService,
  DEFAULT_COVERAGE_THRESHOLD,
} from '@/lib/services/evidence-verifier.service'

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: overrides.id ?? 'ev-' + Math.random().toString(36).slice(2),
    user_id: 'user-1',
    type: (overrides.type ?? 'test-run') as EvidenceType,
    status: overrides.status ?? 'success',
    title: overrides.title ?? 'Evidence',
    metadata: overrides.metadata ?? {},
    created_at: overrides.created_at ?? new Date(),
    updated_at: overrides.updated_at ?? new Date(),
    ...overrides,
  } as Evidence
}

/** Builds a select().from().where().orderBy().limit(...) chain. */
function selectChain(result: Promise<any>) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => result),
        })),
      })),
    })),
  }
}

describe('EvidenceVerifierService (lib/services)', () => {
  let verifier: EvidenceVerifierService
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    verifier = new EvidenceVerifierService()
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  describe('verifyCommit — loading evidence from the database', () => {
    it('returns an empty inspected list and blocks the commit when the DB query throws', async () => {
      dbMock.select.mockReturnValue(selectChain(Promise.reject(new Error('connection refused'))))

      const result = await verifier.verifyCommit({
        userId: 'user-1',
        files: ['src/feature.ts'],
      })

      // loadRecentEvidence() catches the DB error and returns [] rather than
      // propagating — the verifier should treat that as "no evidence found"
      // and block the commit (test-run is required for code changes).
      expect(result.inspected).toEqual([])
      expect(result.passed).toBe(false)
      expect(result.missingEvidence).toContain('test-run')
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load evidence for verification:',
        expect.any(Error)
      )
    })

    it('scopes the query to a git branch when gitBranch is provided', async () => {
      const row = makeEvidence({ type: 'test-run', status: 'success' })
      dbMock.select.mockReturnValue(selectChain(Promise.resolve([row])))

      const result = await verifier.verifyCommit({
        userId: 'user-1',
        gitBranch: 'feature/x',
        files: ['src/feature.ts'],
      })

      expect(result.passed).toBe(true)
      expect(result.inspected).toHaveLength(1)
      expect(dbMock.select).toHaveBeenCalledTimes(1)
    })

    it('loads evidence without branch scoping when gitBranch is omitted', async () => {
      dbMock.select.mockReturnValue(selectChain(Promise.resolve([])))

      const result = await verifier.verifyCommit({
        userId: 'user-1',
        files: ['src/feature.ts'],
      })

      expect(result.inspected).toEqual([])
      expect(result.missingEvidence).toContain('test-run')
    })
  })

  describe('verifyCommit — required evidence inference', () => {
    it('requires test-run when no files are specified at all', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        evidence: [],
      })

      expect(result.missingEvidence).toContain('test-run')
      expect(result.passed).toBe(false)
    })

    it('requires nothing when files is an empty array but not undefined', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        files: [],
        evidence: [],
      })

      // files.length === 0 takes the same branch as "files is undefined":
      // inferRequiredEvidence returns ['test-run'].
      expect(result.missingEvidence).toContain('test-run')
    })

    it('requires nothing for a mixed set of non-code files', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        files: ['README.md', 'package.json', 'public/logo.svg'],
        evidence: [],
      })

      expect(result.passed).toBe(true)
      expect(result.missingEvidence).toHaveLength(0)
    })

    it('requires test-run when at least one touched file matches a code extension', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        files: ['README.md', 'src/app.py'],
        evidence: [],
      })

      expect(result.missingEvidence).toContain('test-run')
    })
  })

  describe('verifyCommit — coverage evidence discovered without being required', () => {
    it('validates coverage when any inspected evidence carries a coveragePercent even if coverage type is not required', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        requiredEvidence: ['test-run'],
        coverageThreshold: 80,
        evidence: [
          makeEvidence({ type: 'test-run', status: 'success' }),
          makeEvidence({ type: 'build', status: 'success', metadata: { coveragePercent: 50 } }),
        ],
      })

      expect(result.coverage).toBeDefined()
      expect(result.coverage?.coverage).toBe(50)
      expect(result.coverage?.passed).toBe(false)
      expect(result.passed).toBe(false)
    })

    it('omits the coverage field entirely when coverage is neither required nor present', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        requiredEvidence: ['test-run'],
        evidence: [makeEvidence({ type: 'test-run', status: 'success' })],
      })

      expect(result.coverage).toBeUndefined()
      expect(result.passed).toBe(true)
    })

    it('reports missing coverage evidence while other required evidence is fine', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        requiredEvidence: ['test-run', 'coverage'],
        evidence: [makeEvidence({ type: 'test-run', status: 'success' })],
      })

      expect(result.missingEvidence).toContain('coverage')
      // No coverage evidence found at all => validateCoverage(null, threshold)
      expect(result.coverage?.passed).toBe(false)
      expect(result.coverage?.coverage).toBeNull()
      expect(result.passed).toBe(false)
    })
  })

  describe('verifyCommit — message composition', () => {
    it('combines missing, failing, and coverage reasons into one message', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        requiredEvidence: ['test-run', 'build', 'coverage'],
        coverageThreshold: 90,
        evidence: [
          makeEvidence({ type: 'build', status: 'failure' }),
          makeEvidence({ type: 'coverage', status: 'success', metadata: { coveragePercent: 10 } }),
        ],
      })

      expect(result.missingEvidence).toContain('test-run')
      expect(result.failedEvidence).toContain('build')
      expect(result.message).toContain('missing evidence: test-run')
      expect(result.message).toContain('failing evidence: build')
      expect(result.message).toContain('below threshold')
      expect(result.message.startsWith('Commit blocked')).toBe(true)
    })

    it('returns the all-clear message when every check passes', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        requiredEvidence: ['test-run'],
        evidence: [makeEvidence({ type: 'test-run', status: 'success' })],
      })

      expect(result.message).toBe('All required evidence present and passing')
    })
  })

  describe('validateCoverage — extractCoverage branches', () => {
    it('returns null for undefined input', () => {
      const result = verifier.validateCoverage(undefined)
      expect(result.coverage).toBeNull()
      expect(result.passed).toBe(false)
    })

    it('treats a bare number as the coverage value directly', () => {
      const result = verifier.validateCoverage(45, 50)
      expect(result.coverage).toBe(45)
      expect(result.passed).toBe(false)
    })

    it('extracts null when an Evidence record has metadata but no coveragePercent field', () => {
      const ev = makeEvidence({ type: 'coverage', metadata: { testsPassed: 10 } })
      const result = verifier.validateCoverage(ev, 80)
      expect(result.coverage).toBeNull()
      expect(result.passed).toBe(false)
      expect(result.message).toContain('No coverage evidence')
    })

    it('extracts null from a raw metadata object with no coveragePercent', () => {
      const result = verifier.validateCoverage({ testsPassed: 5 }, 80)
      expect(result.coverage).toBeNull()
    })

    it('treats coverage exactly at the threshold as passing (inclusive boundary)', () => {
      const result = verifier.validateCoverage(80, 80)
      expect(result.passed).toBe(true)
      expect(result.message).toContain('meets threshold')
    })

    it('treats coverage one point below the threshold as failing', () => {
      const result = verifier.validateCoverage(79.9, 80)
      expect(result.passed).toBe(false)
    })
  })

  describe('verifyEvidencePasses', () => {
    it('returns false for undefined (as distinct from null)', () => {
      expect(verifier.verifyEvidencePasses(undefined)).toBe(false)
    })

    it('returns false for a record with a non-success status such as warning or pending', () => {
      expect(verifier.verifyEvidencePasses(makeEvidence({ status: 'warning' }))).toBe(false)
      expect(verifier.verifyEvidencePasses(makeEvidence({ status: 'pending' }))).toBe(false)
    })

    it('returns true for a successful record', () => {
      expect(verifier.verifyEvidencePasses(makeEvidence({ status: 'success' }))).toBe(true)
    })
  })

  describe('DEFAULT_COVERAGE_THRESHOLD', () => {
    it('is 80', () => {
      expect(DEFAULT_COVERAGE_THRESHOLD).toBe(80)
    })
  })

  describe('getEvidenceVerifierService', () => {
    it('lazily constructs the singleton once and reuses it on subsequent calls', () => {
      const first = getEvidenceVerifierService()
      const second = getEvidenceVerifierService()
      expect(first).toBeInstanceOf(EvidenceVerifierService)
      expect(first).toBe(second)
    })
  })
})
