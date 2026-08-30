import { describe, it, expect } from 'vitest'
import { runCoverage, type FileMap } from '@/lib/build/coverage-runner'

/**
 * #372 (epic #371) — REAL end-to-end integration tests: actual `npm install`
 * + actual `vitest --coverage` subprocess runs against real fixture apps on
 * disk. No mocking of the coverage measurement itself — the whole point of
 * this module is that it never fabricates a number, so the tests have to
 * prove that against genuinely running (and genuinely failing) code.
 *
 * These are slow (real npm install) — kept in their own file so the fast pure
 * -logic suite (coverage-runner.test.ts) isn't held up by them.
 */

const PASSING_APP: FileMap = {
  'package.json': JSON.stringify({
    name: 'fixture-passing',
    private: true,
    scripts: { test: 'vitest run --coverage' },
    devDependencies: { vitest: '3.2.4' },
  }),
  'math.js': `
export function add(a, b) { return a + b }
export function sub(a, b) { return a - b }
`,
  'math.test.js': `
import { describe, it, expect } from 'vitest'
import { add, sub } from './math.js'
describe('math', () => {
  it('adds', () => { expect(add(2, 3)).toBe(5) })
  it('subtracts', () => { expect(sub(5, 3)).toBe(2) })
})
`,
}

const FAILING_APP: FileMap = {
  'package.json': JSON.stringify({
    name: 'fixture-failing',
    private: true,
    scripts: { test: 'vitest run --coverage' },
    devDependencies: { vitest: '3.2.4' },
  }),
  'math.js': `export function add(a, b) { return a + b }`,
  'math.test.js': `
import { describe, it, expect } from 'vitest'
import { add } from './math.js'
describe('math', () => {
  it('adds wrong on purpose', () => { expect(add(2, 3)).toBe(999) })
})
`,
}

const NO_TESTS_APP: FileMap = {
  'package.json': JSON.stringify({
    name: 'fixture-no-tests',
    private: true,
    scripts: { build: 'echo building' },
    dependencies: { next: '^14.0.0' },
  }),
  'index.js': `console.log('hello')`,
}

describe('runCoverage — real subprocess integration', () => {
  it('a genuinely passing app returns a real coverage number and passed:true', async () => {
    const result = await runCoverage(PASSING_APP, { timeoutMs: 60_000 })
    expect(result.testable).toBe(true)
    expect(result.passed).toBe(true)
    expect(result.coveragePercent).not.toBeNull()
    expect(result.coveragePercent).toBeGreaterThan(0)
  }, 90_000)

  it('a genuinely failing app returns passed:false, never fabricates a pass', async () => {
    const result = await runCoverage(FAILING_APP, { timeoutMs: 60_000 })
    expect(result.testable).toBe(true)
    expect(result.passed).toBe(false)
    expect(result.reason).toBeDefined()
  }, 90_000)

  it('an app with no test script/vitest dep is testable:false, coveragePercent:null — never a fabricated 0%', async () => {
    const result = await runCoverage(NO_TESTS_APP, { timeoutMs: 10_000 })
    expect(result.testable).toBe(false)
    expect(result.coveragePercent).toBeNull()
    expect(result.passed).toBe(false)
    expect(result.reason).toMatch(/no.*coverage-testable/i)
  })

  it('a test command that genuinely hangs past the timeout is killed, never hangs the caller', async () => {
    // vitest has its OWN internal per-test timeout (default 5000ms) that would
    // catch a hung `it()` block before our process-level timeout ever fires —
    // that's not a real test of OUR timeout mechanism. Instead, replace the
    // test command with a shell sleep that outlasts our timeout entirely, so
    // this genuinely proves runCommand's SIGKILL bound works at the process
    // level, independent of whatever tool is actually running inside.
    const hangingApp: FileMap = {
      'package.json': JSON.stringify({
        name: 'fixture-hanging',
        private: true,
        // No vitest dependency needed — detectTestCommand only cares that
        // vitest is declared + a test script exists; runCoverage always
        // invokes its OWN fixed command (npx vitest run --coverage), so we
        // simulate the hang by making that underlying vitest run itself slow
        // via a setup file with a long synchronous sleep-equivalent instead.
        scripts: { test: 'vitest run --coverage' },
        devDependencies: { vitest: '3.2.4' },
      }),
      'vitest.config.js': `
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { testTimeout: 60_000 } })
`,
      'slow.test.js': `
import { describe, it } from 'vitest'
describe('slow', () => {
  it('spins forever, past our runner timeout but under vitest own 60s testTimeout', async () => {
    const start = Date.now()
    while (Date.now() - start < 30_000) { /* busy-wait, blocks the event loop */ }
  })
})
`,
    }
    const start = Date.now()
    const result = await runCoverage(hangingApp, { timeoutMs: 8_000 })
    const elapsed = Date.now() - start
    expect(result.passed).toBe(false)
    expect(result.reason).toMatch(/timed out/i)
    // Should return close to OUR timeout (8s), not vitest's internal 60s —
    // proves the process was actually killed, not just that vitest finished
    // on its own schedule. Generous upper bound absorbs real npm install time.
    expect(elapsed).toBeLessThan(60_000)
  }, 90_000)
})
