/**
 * Evidence Verifier Service Tests
 *
 * Covers the verification layer from issue #19:
 *  - blocking commits without required evidence
 *  - flagging failing evidence
 *  - coverage threshold validation
 *  - loading evidence from the database
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Evidence, EvidenceType } from '@/lib/types/evidence'

// --- DB mock (used only by the load-from-db path) ------------------------
const dbRows: Evidence[] = []
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(dbRows)),
          })),
        })),
      })),
    })),
  },
}))

import {
  EvidenceVerifierService,
  getEvidenceVerifierService,
  DEFAULT_COVERAGE_THRESHOLD,
} from '@/lib/services/evidence-verifier.service'

function makeEvidence(overrides: Partial<Evidence>): Evidence {
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

describe('EvidenceVerifierService', () => {
  let verifier: EvidenceVerifierService

  beforeEach(() => {
    verifier = new EvidenceVerifierService()
    dbRows.length = 0
  })

  describe('verifyCommit', () => {
    it('blocks a commit without test evidence', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        message: 'Add feature',
        files: ['src/feature.ts'],
        evidence: [], // no evidence collected
      })

      expect(result.passed).toBe(false)
      expect(result.missingEvidence).toContain('test-run')
      expect(result.message).toContain('missing evidence')
    })

    it('passes when required test evidence is present and successful', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        files: ['src/feature.ts'],
        evidence: [makeEvidence({ type: 'test-run', status: 'success' })],
      })

      expect(result.passed).toBe(true)
      expect(result.missingEvidence).toHaveLength(0)
      expect(result.failedEvidence).toHaveLength(0)
    })

    it('flags failing test evidence', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        files: ['src/feature.ts'],
        evidence: [makeEvidence({ type: 'test-run', status: 'failure' })],
      })

      expect(result.passed).toBe(false)
      expect(result.failedEvidence).toContain('test-run')
      expect(result.message).toContain('failing evidence')
    })

    it('uses the newest evidence for a required type', async () => {
      const older = makeEvidence({
        type: 'test-run',
        status: 'failure',
        created_at: new Date('2024-01-01'),
      })
      const newer = makeEvidence({
        type: 'test-run',
        status: 'success',
        created_at: new Date('2024-02-01'),
      })

      // list is newest-first, matching DB ordering
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        files: ['src/feature.ts'],
        evidence: [newer, older],
      })

      expect(result.passed).toBe(true)
      expect(result.failedEvidence).toHaveLength(0)
    })

    it('requires only test-run for pure code changes and passes for docs-only commits', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        files: ['README.md', 'docs/guide.md'],
        evidence: [],
      })

      // No code files => no required evidence => allowed.
      expect(result.passed).toBe(true)
      expect(result.missingEvidence).toHaveLength(0)
    })

    it('honours explicit requiredEvidence over inference', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        requiredEvidence: ['test-run', 'build'],
        evidence: [makeEvidence({ type: 'test-run', status: 'success' })],
      })

      expect(result.passed).toBe(false)
      expect(result.missingEvidence).toContain('build')
    })

    it('validates coverage against the threshold when coverage is required', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        requiredEvidence: ['coverage'],
        coverageThreshold: 80,
        evidence: [
          makeEvidence({
            type: 'coverage',
            status: 'success',
            metadata: { coveragePercent: 75 },
          }),
        ],
      })

      expect(result.passed).toBe(false)
      expect(result.coverage?.passed).toBe(false)
      expect(result.coverage?.coverage).toBe(75)
      expect(result.message).toContain('below threshold')
    })

    it('passes coverage when at or above the threshold', async () => {
      const result = await verifier.verifyCommit({
        userId: 'user-1',
        requiredEvidence: ['coverage'],
        coverageThreshold: 80,
        evidence: [
          makeEvidence({
            type: 'coverage',
            status: 'success',
            metadata: { coveragePercent: 92 },
          }),
        ],
      })

      expect(result.passed).toBe(true)
      expect(result.coverage?.passed).toBe(true)
      expect(result.coverage?.coverage).toBe(92)
    })

    it('loads evidence from the database when none is injected', async () => {
      dbRows.push(makeEvidence({ type: 'test-run', status: 'success' }))

      const result = await verifier.verifyCommit({
        userId: 'user-1',
        files: ['src/feature.ts'],
      })

      expect(result.inspected).toHaveLength(1)
      expect(result.passed).toBe(true)
    })
  })

  describe('validateCoverage', () => {
    it('fails when coverage is below the threshold', () => {
      const result = verifier.validateCoverage(75, 80)
      expect(result.passed).toBe(false)
      expect(result.message).toContain('below threshold')
    })

    it('passes when coverage meets the threshold', () => {
      const result = verifier.validateCoverage(80, 80)
      expect(result.passed).toBe(true)
      expect(result.message).toContain('meets threshold')
    })

    it('extracts coverage from an evidence record', () => {
      const evidence = makeEvidence({
        type: 'coverage',
        metadata: { coveragePercent: 88 },
      })
      const result = verifier.validateCoverage(evidence, 80)
      expect(result.passed).toBe(true)
      expect(result.coverage).toBe(88)
    })

    it('extracts coverage from a raw metadata object', () => {
      const result = verifier.validateCoverage({ coveragePercent: 60 }, 80)
      expect(result.passed).toBe(false)
      expect(result.coverage).toBe(60)
    })

    it('fails gracefully when no coverage data is available', () => {
      const result = verifier.validateCoverage(null, 80)
      expect(result.passed).toBe(false)
      expect(result.coverage).toBeNull()
      expect(result.message).toContain('No coverage evidence')
    })

    it('uses the default threshold when none is provided', () => {
      const result = verifier.validateCoverage(DEFAULT_COVERAGE_THRESHOLD)
      expect(result.threshold).toBe(DEFAULT_COVERAGE_THRESHOLD)
      expect(result.passed).toBe(true)
    })
  })

  describe('verifyEvidencePasses', () => {
    it('returns true only for successful evidence', () => {
      expect(verifier.verifyEvidencePasses(makeEvidence({ status: 'success' }))).toBe(true)
      expect(verifier.verifyEvidencePasses(makeEvidence({ status: 'failure' }))).toBe(false)
      expect(verifier.verifyEvidencePasses(null)).toBe(false)
    })
  })

  describe('getEvidenceVerifierService', () => {
    it('returns a singleton instance', () => {
      expect(getEvidenceVerifierService()).toBe(getEvidenceVerifierService())
    })
  })
})
