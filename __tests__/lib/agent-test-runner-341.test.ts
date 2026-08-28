import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * builder#341 — TDD for generated apps: the agent writes ONE vitest file per
 * app, the worktree runner executes it before ready, and an unrepaired failure
 * feeds the same 422 retry path as a parse failure (ready-gate).
 *
 * Covers the pure logic (file selection, outcome classification, summary
 * bounding, prompt instructions, result store + TTL), the ready-gate wiring,
 * the verify-loop opt-out, and a real end-to-end spawn of vitest inside a
 * scaffold-shaped worktree (pass + fail), proving the runner mechanics.
 */

// Ready-gate deps mocked so checkAppReady is exercisable without stores.
const getPreview = vi.fn<(id: string) => string | undefined>()
const getFilesV2 = vi.fn<(id: string) => Record<string, string> | null>()
const loadGeneration = vi.fn(async (_id: string) => null as any)

vi.mock('@/lib/preview-store', () => ({ getPreview: (id: string) => getPreview(id) }))
vi.mock('@/lib/preview-store-v2', () => ({ getFiles: (id: string) => getFilesV2(id) }))
vi.mock('@/lib/zerodb-store', () => ({ loadGeneration: (id: string) => loadGeneration(id) }))

import {
  WORKTREE_TEST_FILE,
  TEST_RESULT_TTL_MS,
  findGeneratedTestFile,
  stripTestFiles,
  classifyVitestOutcome,
  summarizeTestOutput,
  buildTestFailureError,
  buildTestGenerationInstructions,
  isWorktreeTestGateEnabled,
  recordWorktreeTestResult,
  getWorktreeTestFailure,
  clearWorktreeTestResult,
  ensureWorktreeNodeModules,
  runWorktreeTests,
  type WorktreeTestOutcome,
} from '@/lib/agent/test-runner'
import { buildVerifyAgentOptions } from '@/lib/agent/verify-loop'
import { checkAppReady } from '@/lib/build/ready-gate'

const failOutcome = (summary = '1 test failed'): WorktreeTestOutcome => ({
  status: 'fail',
  testFile: WORKTREE_TEST_FILE,
  summary,
  durationMs: 500,
})

beforeEach(() => {
  getPreview.mockReturnValue(undefined)
  getFilesV2.mockReturnValue(null)
  loadGeneration.mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// findGeneratedTestFile — exactly one test file, canonical preferred
// ---------------------------------------------------------------------------

describe('findGeneratedTestFile', () => {
  it('prefers the canonical src/App.test.tsx', () => {
    expect(
      findGeneratedTestFile(['src/App.tsx', 'src/other.test.tsx', 'src/App.test.tsx']),
    ).toBe('src/App.test.tsx')
  })

  it('falls back to the first (sorted) test-shaped file', () => {
    expect(
      findGeneratedTestFile(['src/App.tsx', 'src/zz.spec.ts', 'src/aa.test.jsx']),
    ).toBe('src/aa.test.jsx')
  })

  it('returns null when no test file was written', () => {
    expect(findGeneratedTestFile(['src/App.tsx', 'src/main.tsx', 'index.html'])).toBeNull()
  })

  it('ignores anything under node_modules', () => {
    expect(findGeneratedTestFile(['node_modules/x/y.test.ts'])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// stripTestFiles — the test file never enters the preview files map
// ---------------------------------------------------------------------------

describe('stripTestFiles', () => {
  it('removes test files and keeps app files', () => {
    const files = {
      'src/App.tsx': 'app',
      'src/App.test.tsx': 'test',
      'src/util.spec.ts': 'spec',
      'src/main.tsx': 'main',
    }
    expect(Object.keys(stripTestFiles(files)).sort()).toEqual(['src/App.tsx', 'src/main.tsx'])
  })

  it('is a no-op when there are no test files', () => {
    const files = { 'src/App.tsx': 'app' }
    expect(stripTestFiles(files)).toEqual(files)
  })
})

// ---------------------------------------------------------------------------
// classifyVitestOutcome — only unambiguous test failures are 'fail'
// ---------------------------------------------------------------------------

describe('classifyVitestOutcome', () => {
  it('exit 0 → pass', () => {
    expect(classifyVitestOutcome(0, 'Tests  2 passed (2)')).toBe('pass')
  })

  it('exit 1 with a failed-tests tally → fail', () => {
    expect(classifyVitestOutcome(1, ' Test Files  1 failed (1)\n      Tests  1 failed (1)')).toBe('fail')
  })

  it('exit 1 with "No test files found" → skipped (fail-open)', () => {
    expect(classifyVitestOutcome(1, 'No test files found, exiting with code 1')).toBe('skipped')
  })

  it('exit 1 with unclassifiable output → infra_error (fail-open)', () => {
    expect(classifyVitestOutcome(1, 'Error: Cannot find module vite')).toBe('infra_error')
  })

  it('null exit (killed / timeout) → infra_error (fail-open)', () => {
    expect(classifyVitestOutcome(null, 'partial output')).toBe('infra_error')
  })
})

// ---------------------------------------------------------------------------
// summarizeTestOutput / buildTestFailureError — bounded, prompt-ready
// ---------------------------------------------------------------------------

describe('summarizeTestOutput', () => {
  it('starts at the Failed Tests marker when present', () => {
    const out = 'lots of noise\nmore noise\nFailed Tests 1\nexpected 1 to be 2'
    expect(summarizeTestOutput(out)).toBe('Failed Tests 1\nexpected 1 to be 2')
  })

  it('bounds the summary length (keeps the tail)', () => {
    const out = 'x'.repeat(5000) + 'THE-END'
    const summary = summarizeTestOutput(out, 100)
    expect(summary.length).toBe(100)
    expect(summary.endsWith('THE-END')).toBe(true)
  })

  it('strips ANSI color codes', () => {
    expect(summarizeTestOutput('[31mfail[0m')).toBe('fail')
  })

  it('buildTestFailureError names vitest and carries the summary', () => {
    const err = buildTestFailureError('expected "Tasks" in HTML')
    expect(err).toContain('vitest')
    expect(err).toContain('expected "Tasks" in HTML')
  })
})

// ---------------------------------------------------------------------------
// Prompt instructions — what the agent is told to write
// ---------------------------------------------------------------------------

describe('buildTestGenerationInstructions', () => {
  const text = buildTestGenerationInstructions()

  it('targets the canonical pre-seeded test file via EDIT, never new files/shell', () => {
    expect(text).toContain(WORKTREE_TEST_FILE)
    expect(text).toContain('ALREADY EXISTS')
    expect(text).toContain('EDIT it')
    expect(text).toContain('never shell commands')
  })

  it('requires explicit vitest imports (globals off in the worktree)', () => {
    expect(text).toContain("from 'vitest'")
  })

  it('uses renderToString (Node env, no DOM) and mocks fetch for /api/db', () => {
    expect(text).toContain('renderToString')
    expect(text).toContain("react-dom/server")
    expect(text).toContain('fetch')
    expect(text).toContain('/api/db')
  })
})

// ---------------------------------------------------------------------------
// Gate kill-switch
// ---------------------------------------------------------------------------

describe('isWorktreeTestGateEnabled', () => {
  it('is ON by default and OFF only with CODY_WORKTREE_TESTS=0', () => {
    vi.stubEnv('CODY_WORKTREE_TESTS', '')
    expect(isWorktreeTestGateEnabled()).toBe(true)
    vi.stubEnv('CODY_WORKTREE_TESTS', '1')
    expect(isWorktreeTestGateEnabled()).toBe(true)
    vi.stubEnv('CODY_WORKTREE_TESTS', '0')
    expect(isWorktreeTestGateEnabled()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Result store — record / read / clear / TTL
// ---------------------------------------------------------------------------

describe('worktree test result store', () => {
  it('surfaces only failures; pass and infra outcomes read as null', () => {
    recordWorktreeTestResult('c-pass', { ...failOutcome(), status: 'pass' })
    recordWorktreeTestResult('c-infra', { ...failOutcome(), status: 'infra_error' })
    recordWorktreeTestResult('c-fail', failOutcome('boom'))

    expect(getWorktreeTestFailure('c-pass')).toBeNull()
    expect(getWorktreeTestFailure('c-infra')).toBeNull()
    expect(getWorktreeTestFailure('c-fail')?.error).toContain('boom')
    expect(getWorktreeTestFailure('c-unknown')).toBeNull()

    clearWorktreeTestResult('c-fail')
    clearWorktreeTestResult('c-pass')
    clearWorktreeTestResult('c-infra')
  })

  it('clearWorktreeTestResult removes the block (verify-loop repair path)', () => {
    recordWorktreeTestResult('c-repair', failOutcome())
    expect(getWorktreeTestFailure('c-repair')).not.toBeNull()
    clearWorktreeTestResult('c-repair')
    expect(getWorktreeTestFailure('c-repair')).toBeNull()
  })

  it('expires records after the TTL so a stale failure never blocks forever', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T00:00:00Z'))
    recordWorktreeTestResult('c-ttl', failOutcome())
    expect(getWorktreeTestFailure('c-ttl')).not.toBeNull()

    vi.setSystemTime(new Date(Date.now() + TEST_RESULT_TTL_MS + 1000))
    expect(getWorktreeTestFailure('c-ttl')).toBeNull()
  })

  it('a newer run overwrites the previous record (regeneration path)', () => {
    recordWorktreeTestResult('c-regen', failOutcome())
    expect(getWorktreeTestFailure('c-regen')).not.toBeNull()
    recordWorktreeTestResult('c-regen', { ...failOutcome(), status: 'pass' })
    expect(getWorktreeTestFailure('c-regen')).toBeNull()
    clearWorktreeTestResult('c-regen')
  })
})

// ---------------------------------------------------------------------------
// Ready-gate wiring — failing tests feed the same 422 retry path
// ---------------------------------------------------------------------------

describe('checkAppReady × generated tests (#341)', () => {
  it('blocks readiness with reason generated_tests_failed on a recorded failure', async () => {
    recordWorktreeTestResult('chat-tdd-1', failOutcome('expected heading'))
    const ready = await checkAppReady('chat-tdd-1')
    expect(ready.checked).toBe(true)
    expect(ready.ok).toBe(false)
    expect(ready.reason).toBe('generated_tests_failed')
    expect(ready.error).toContain('expected heading')
    clearWorktreeTestResult('chat-tdd-1')
  })

  it('fails open (store miss path) when no test result was recorded', async () => {
    const ready = await checkAppReady('chat-tdd-none')
    expect(ready.checked).toBe(false)
    expect(ready.ok).toBe(true)
  })

  it('accepts the app again once the failure is cleared (repair path)', async () => {
    recordWorktreeTestResult('chat-tdd-2', failOutcome())
    clearWorktreeTestResult('chat-tdd-2')
    const ready = await checkAppReady('chat-tdd-2')
    expect(ready.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Verify-loop — repair passes never re-enter the gate
// ---------------------------------------------------------------------------

describe('buildVerifyAgentOptions', () => {
  it('opts repair runs out of the worktree test gate', () => {
    expect(buildVerifyAgentOptions().runGeneratedTests).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Runner integration — real vitest spawn in a scaffold-shaped worktree
// ---------------------------------------------------------------------------

describe('runWorktreeTests (integration — real vitest spawn)', () => {
  let dir: string

  const scaffold = async (appTsx: string, testTsx: string | null) => {
    dir = await mkdtemp(join(tmpdir(), 'wt-341-'))
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'builder-session', private: true, type: 'module' }),
    )
    await writeFile(
      join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { jsx: 'react-jsx', strict: true, noEmit: true }, include: ['src'] }),
    )
    await writeFile(join(dir, 'src', 'App.tsx'), appTsx)
    if (testTsx) await writeFile(join(dir, 'src', WORKTREE_TEST_FILE.split('/')[1]), testTsx)
  }

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  const APP = `export default function App() { return <div><h1>Task Tracker</h1><button>Add Task</button></div> }`

  it('passes for a healthy app + test (symlinked node_modules)', async () => {
    await scaffold(
      APP,
      [
        `import { it, expect, vi } from 'vitest'`,
        `import { renderToString } from 'react-dom/server'`,
        `import App from './App'`,
        `vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ rows: [] }) })))`,
        `it('renders', () => { expect(renderToString(<App />)).toContain('Task Tracker') })`,
      ].join('\n'),
    )
    const outcome = await runWorktreeTests(dir, WORKTREE_TEST_FILE)
    expect(outcome.status).toBe('pass')
  }, 60_000)

  it('fails (real signal) when the test genuinely fails', async () => {
    await scaffold(
      APP,
      [
        `import { it, expect } from 'vitest'`,
        `import { renderToString } from 'react-dom/server'`,
        `import App from './App'`,
        `it('renders the wrong thing', () => { expect(renderToString(<App />)).toContain('NOT-IN-THE-APP') })`,
      ].join('\n'),
    )
    const outcome = await runWorktreeTests(dir, WORKTREE_TEST_FILE)
    expect(outcome.status).toBe('fail')
    expect(outcome.summary).toContain('NOT-IN-THE-APP')
  }, 60_000)

  it('ensureWorktreeNodeModules is idempotent', async () => {
    await scaffold(APP, null)
    expect(await ensureWorktreeNodeModules(dir)).toBe(true)
    expect(await ensureWorktreeNodeModules(dir)).toBe(true)
  })

  it('fails open (infra_error) when node_modules cannot be linked', async () => {
    await scaffold(APP, null)
    const outcome = await runWorktreeTests(dir, WORKTREE_TEST_FILE, {
      repoRoot: '/nonexistent-repo-root-341',
    })
    // Symlink to a missing target still "creates"; the vitest bin check is the
    // real guard — either way this must be infra (fail-open), never 'fail'.
    expect(['infra_error', 'skipped']).toContain(outcome.status)
  }, 60_000)
})

// ---------------------------------------------------------------------------
// Scaffold seed — the worktree ships a baseline test the agent only EDITS
// ---------------------------------------------------------------------------

describe('worktree scaffold seeds src/App.test.tsx (#341)', () => {
  it('createWorktree writes a runnable baseline render-smoke test that PASSES against the scaffold App', async () => {
    const { createWorktree, getWorktreePath } = await import('@/lib/agent/worktree-manager')
    const chatId = `scaffold-341-${Date.now()}`
    try {
      const dir = await createWorktree(chatId)
      expect(dir).toBe(getWorktreePath(chatId))
      // The seed exists and follows the required pattern (vitest imports,
      // fetch stub, renderToString — no DOM).
      const { readFile } = await import('fs/promises')
      const seed = await readFile(join(dir, WORKTREE_TEST_FILE), 'utf-8')
      expect(seed).toContain("from 'vitest'")
      expect(seed).toContain('renderToString')
      expect(seed).toContain("vi.stubGlobal('fetch'")
      // And it genuinely runs + passes against the scaffold App — the gate has
      // a real executed baseline even when the agent never edits the tests.
      const outcome = await runWorktreeTests(dir, WORKTREE_TEST_FILE)
      expect(outcome.status).toBe('pass')
    } finally {
      const { cleanupWorktree: cleanup } = await import('@/lib/agent/worktree-manager')
      await cleanup(chatId)
    }
  }, 60_000)
})
