import { describe, it, expect } from 'vitest'
import {
  detectTestCommand,
  parseCoverageSummary,
} from '@/lib/build/coverage-runner'

/**
 * #372 (epic #371) — pure-logic unit tests for the coverage-gated verification
 * runner. See coverage-runner.integration.test.ts for the real subprocess
 * end-to-end tests (npm install + vitest actually running).
 */

describe('detectTestCommand', () => {
  it('returns null for a generated app with no package.json at all', () => {
    expect(detectTestCommand(undefined)).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(detectTestCommand('{ not json')).toBeNull()
  })

  it('returns null when vitest is not a declared dependency, even with a test script', () => {
    const pkg = JSON.stringify({
      scripts: { test: 'vitest run' },
      dependencies: {},
      devDependencies: {},
    })
    // A "test" script referencing vitest but NOT declaring it as a dependency
    // must not be trusted — never assume a tool that isn't installed will
    // magically be available.
    expect(detectTestCommand(pkg)).toBeNull()
  })

  it('returns null when vitest IS a dependency but no test script exists', () => {
    const pkg = JSON.stringify({
      scripts: { build: 'next build' },
      devDependencies: { vitest: '^3.0.0' },
    })
    expect(detectTestCommand(pkg)).toBeNull()
  })

  it('detects a real coverage-testable app: vitest dependency + test script', () => {
    const pkg = JSON.stringify({
      scripts: { test: 'vitest run' },
      devDependencies: { vitest: '^3.0.0' },
    })
    const result = detectTestCommand(pkg)
    expect(result).not.toBeNull()
    expect(result?.command).toBe('npx')
    expect(result?.args).toContain('--coverage')
  })

  it('prefers an explicit test:coverage script when present', () => {
    const pkg = JSON.stringify({
      scripts: { test: 'vitest run', 'test:coverage': 'vitest run --coverage' },
      devDependencies: { vitest: '^3.0.0' },
    })
    expect(detectTestCommand(pkg)).not.toBeNull()
  })

  it('checks both dependencies and devDependencies for vitest', () => {
    const pkg = JSON.stringify({
      scripts: { test: 'vitest run' },
      dependencies: { vitest: '^3.0.0' },
    })
    expect(detectTestCommand(pkg)).not.toBeNull()
  })
})

describe('parseCoverageSummary', () => {
  it('returns null when the summary file content is undefined (run never produced one)', () => {
    expect(parseCoverageSummary(undefined)).toBeNull()
  })

  it('returns null for malformed JSON — never guesses a number', () => {
    expect(parseCoverageSummary('{ not json')).toBeNull()
  })

  it('returns null when the total.statements/lines shape is missing entirely', () => {
    expect(parseCoverageSummary(JSON.stringify({ total: {} }))).toBeNull()
  })

  it('parses a real statements percentage', () => {
    const raw = JSON.stringify({ total: { statements: { pct: 87.5 }, lines: { pct: 90 } } })
    expect(parseCoverageSummary(raw)).toBe(87.5)
  })

  it('falls back to lines.pct when statements.pct is absent', () => {
    const raw = JSON.stringify({ total: { lines: { pct: 42.1 } } })
    expect(parseCoverageSummary(raw)).toBe(42.1)
  })

  it('returns null (not 0) when pct is present but not a number', () => {
    const raw = JSON.stringify({ total: { statements: { pct: 'Unknown' } } })
    expect(parseCoverageSummary(raw)).toBeNull()
  })
})
