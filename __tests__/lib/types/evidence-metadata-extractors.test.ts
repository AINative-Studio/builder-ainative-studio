import { describe, it, expect } from 'vitest'
import { METADATA_EXTRACTORS } from '@/lib/types/evidence'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * lib/types/evidence.ts is mostly type declarations, but it also exports
 * METADATA_EXTRACTORS — real regex-based parsers for vitest/jest/pytest/tsc/
 * vite CLI output, used to backfill structured evidence metadata from raw
 * command output. This logic had no dedicated test (existing evidence-*
 * service tests cover the service layer, not these extractors).
 */
describe('#1201 lib/types/evidence METADATA_EXTRACTORS', () => {
  describe('vitest extractor', () => {
    const { extract } = METADATA_EXTRACTORS.vitest

    it('parses passed/failed/total test counts, coverage percent, and duration from real vitest output', () => {
      const output = `
 Test Files  3 passed (3)
      Tests  42 passed (42)
   Duration  1234ms
 All files          |   85.72 |    80.19 |    87.5 |   85.72 |
      `
      const metadata = extract(output)
      expect(metadata.testsPassed).toBe(3)
      expect(metadata.totalTests).toBe(42)
      expect(metadata.coveragePercent).toBe(85.72)
      expect(metadata.testDuration).toBe(1234)
    })

    it('extracts a failed count when present', () => {
      const output = 'Test Files  1 passed, 2 failed'
      const metadata = extract(output)
      expect(metadata.testsFailed).toBe(2)
    })

    it('returns an empty object for output matching none of its patterns', () => {
      expect(extract('nothing relevant here')).toEqual({})
    })
  })

  describe('jest extractor', () => {
    const { extract } = METADATA_EXTRACTORS.jest

    it('parses passed/failed/total counts and coverage from real jest output', () => {
      const output = `
Tests:       38 passed, 40 total
All files          |   72.1   |
      `
      const metadata = extract(output)
      expect(metadata.testsPassed).toBe(38)
      expect(metadata.totalTests).toBe(40)
      expect(metadata.coveragePercent).toBe(72.1)
    })

    it('extracts a failed count when present', () => {
      const metadata = extract('Tests: 2 failed, 38 passed, 40 total')
      expect(metadata.testsFailed).toBe(2)
    })

    it('returns an empty object when nothing matches', () => {
      expect(extract('irrelevant text')).toEqual({})
    })
  })

  describe('pytest extractor', () => {
    const { extract } = METADATA_EXTRACTORS.pytest

    it('parses passed/failed counts and a TOTAL coverage percentage', () => {
      const output = `
===== 15 passed, 2 failed in 3.21s =====
TOTAL                      120     12    90%
      `
      const metadata = extract(output)
      expect(metadata.testsPassed).toBe(15)
      expect(metadata.testsFailed).toBe(2)
      expect(metadata.coveragePercent).toBe(90)
    })

    it('returns an empty object when output has no recognizable pytest summary', () => {
      expect(extract('no test output here')).toEqual({})
    })
  })

  describe('tsc extractor', () => {
    const { extract } = METADATA_EXTRACTORS.tsc

    it('reports buildSuccess:false with the real error count when errors are found', () => {
      const metadata = extract('Found 3 errors in 2 files.')
      expect(metadata.buildErrors).toBe(3)
      expect(metadata.buildSuccess).toBe(false)
    })

    it('reports buildSuccess:true with zero errors when no "Found N error" line is present (clean build)', () => {
      const metadata = extract('')
      expect(metadata.buildErrors).toBe(0)
      expect(metadata.buildSuccess).toBe(true)
    })

    it('treats "Found 0 errors" as itself matching, still success', () => {
      const metadata = extract('Found 0 errors.')
      expect(metadata.buildErrors).toBe(0)
      expect(metadata.buildSuccess).toBe(true)
    })
  })

  describe('vite extractor', () => {
    const { extract } = METADATA_EXTRACTORS.vite

    it('parses a bundle size in kB and converts it to bytes', () => {
      const metadata = extract('dist/index-abc123.js   142.50 kB')
      expect(metadata.bundleSize).toBe(142.5 * 1024)
    })

    it('reports buildSuccess:true when the output contains no "error" substring', () => {
      const metadata = extract('dist/index.js  10.00 kB │ gzip: 3.00 kB')
      expect(metadata.buildSuccess).toBe(true)
    })

    it('reports buildSuccess:false when the output contains "error"', () => {
      const metadata = extract('Build failed with 1 error')
      expect(metadata.buildSuccess).toBe(false)
    })

    it('omits bundleSize entirely when no dist/*.kB line is present', () => {
      const metadata = extract('some unrelated vite output')
      expect(metadata.bundleSize).toBeUndefined()
    })
  })

  it('exposes a framework name on every extractor matching its key', () => {
    expect(METADATA_EXTRACTORS.vitest.framework).toBe('vitest')
    expect(METADATA_EXTRACTORS.jest.framework).toBe('jest')
    expect(METADATA_EXTRACTORS.pytest.framework).toBe('pytest')
    expect(METADATA_EXTRACTORS.tsc.framework).toBe('typescript')
    expect(METADATA_EXTRACTORS.vite.framework).toBe('vite')
  })
})
