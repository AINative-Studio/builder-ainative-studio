import { describe, it, expect } from 'vitest'
import { decideOutcomeFromCoverage } from '@/lib/build/task-resolver'

/**
 * #374 (epic #371) — pure-logic tests for the coverage→stage decision.
 * See task-resolver-io.test.ts for the full mocked end-to-end pipeline tests.
 */

describe('decideOutcomeFromCoverage', () => {
  it('accepts a genuinely untestable app (no test suite) on implementation alone — never blocked on an impossible number', () => {
    const result = decideOutcomeFromCoverage({ coveragePercent: null, testable: false, passed: false })
    expect(result.stage).toBe('completed')
    expect(result.reason).toMatch(/no test suite/i)
  })

  it('fails when tests genuinely did not pass', () => {
    const result = decideOutcomeFromCoverage({
      coveragePercent: 90, testable: true, passed: false, reason: 'Test run exited with code 1',
    })
    expect(result.stage).toBe('failed')
    expect(result.reason).toBe('Test run exited with code 1')
  })

  it('fails honestly when tests passed but coverage could not be measured — never fabricates a number to force a pass', () => {
    const result = decideOutcomeFromCoverage({ coveragePercent: null, testable: true, passed: true })
    expect(result.stage).toBe('failed')
    expect(result.reason).toMatch(/could not be measured/i)
  })

  it('fails when a REAL coverage number is below the floor', () => {
    const result = decideOutcomeFromCoverage({ coveragePercent: 42, testable: true, passed: true })
    expect(result.stage).toBe('failed')
    expect(result.reason).toMatch(/42%/)
    expect(result.reason).toMatch(/80%/)
  })

  it('completes when a REAL coverage number meets the floor', () => {
    const result = decideOutcomeFromCoverage({ coveragePercent: 85, testable: true, passed: true })
    expect(result.stage).toBe('completed')
    expect(result.reason).toMatch(/85%/)
  })

  it('completes when coverage is exactly at the floor (>= not >)', () => {
    const result = decideOutcomeFromCoverage({ coveragePercent: 80, testable: true, passed: true })
    expect(result.stage).toBe('completed')
  })

  it('respects a custom floor override', () => {
    const result = decideOutcomeFromCoverage({ coveragePercent: 70, testable: true, passed: true }, 60)
    expect(result.stage).toBe('completed')
  })
})
