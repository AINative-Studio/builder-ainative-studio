/**
 * Worktree test runner — TDD for generated apps (builder#341).
 *
 * The agent primary path (runHeadlessAgent) asks Cody to write ONE vitest file
 * alongside the generated app (src/App.test.tsx). This module RUNS that file in
 * the session worktree before the app is marked ready:
 *
 *   agent writes src/App.tsx + src/App.test.tsx
 *     → runWorktreeTests() spawns `node_modules/.bin/vitest run <file>` in the
 *       worktree (node_modules symlinked from the builder repo — the scaffold
 *       never installs its own deps)
 *     → outcome recorded per-chatId (recordWorktreeTestResult)
 *     → chat-ws feeds a FAIL to the dormant verify-loop repair agent
 *     → ready-gate (checkAppReady) consults the record: an unrepaired FAIL
 *       blocks register-app with the same 422 retry path as a parse failure.
 *
 * Runtime is bounded by design: exactly one test file, a hard 60s timeout, and
 * FAIL-OPEN on every infra error (missing runner, spawn failure, timeout, no
 * test file written). Only a genuinely failing test — real signal about the
 * generated app — ever blocks readiness. We never block on tooling.
 *
 * The generated tests run in vitest's default Node environment (no jsdom in the
 * dependency tree), so the test instructions target react-dom/server
 * renderToString — which still catches the historical failure classes
 * ("Element type is invalid", undefined references, render-path crashes) — with
 * global fetch mocked so any /api/db call is a mocked round-trip.
 */

import { spawn } from 'child_process'
import { access, symlink } from 'fs/promises'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The single test file the agent is instructed to write. */
export const WORKTREE_TEST_FILE = 'src/App.test.tsx'

/** Hard cap on a worktree test run — a hang is treated as infra (fail-open). */
export const WORKTREE_TEST_TIMEOUT_MS = 60_000

/** Cap captured runner output so a log-spamming test can't balloon memory. */
const MAX_OUTPUT_BYTES = 200_000

/** Cap the failure summary we carry into prompts / 422 bodies. */
const MAX_SUMMARY_CHARS = 1_200

/** Recorded outcomes expire after this — a stale FAIL must not block forever. */
export const TEST_RESULT_TTL_MS = 15 * 60_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorktreeTestStatus = 'pass' | 'fail' | 'skipped' | 'infra_error'

export interface WorktreeTestOutcome {
  status: WorktreeTestStatus
  /** Worktree-relative path of the test file that ran (null when skipped). */
  testFile: string | null
  /** Human-readable summary (failure tail / infra reason / pass counts). */
  summary: string
  durationMs: number
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const TEST_FILE_RE = /\.(test|spec)\.[jt]sx?$/

/**
 * Pick the ONE generated test file to run from a worktree file listing.
 * Prefers the canonical src/App.test.tsx; otherwise the first test-shaped
 * path (sorted for determinism). Bounded scope: never more than one file.
 */
export function findGeneratedTestFile(paths: string[]): string | null {
  const candidates = paths
    .filter((p) => TEST_FILE_RE.test(p) && !p.includes('node_modules'))
    .sort()
  if (candidates.length === 0) return null
  if (candidates.includes(WORKTREE_TEST_FILE)) return WORKTREE_TEST_FILE
  return candidates[0]
}

/**
 * Remove test files from the files map yielded to the pipeline. The test file
 * is an internal verification artifact — letting it into the preview files map
 * would flip single-file apps into the multi-file (Sandpack) path and persist
 * a file the app never imports.
 */
export function stripTestFiles(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, content] of Object.entries(files)) {
    if (!TEST_FILE_RE.test(path)) out[path] = content
  }
  return out
}

/**
 * Classify a vitest run. Only an unambiguous test failure is 'fail' — every
 * other nonzero outcome (config explosion, missing files, OOM, garbage) is
 * infra and MUST fail open. vitest exits 1 both for failing tests and for
 * "No test files found", so classification needs the output.
 */
export function classifyVitestOutcome(
  exitCode: number | null,
  output: string,
): WorktreeTestStatus {
  if (exitCode === 0) return 'pass'
  if (exitCode === null) return 'infra_error' // killed (timeout) / never exited
  if (/no test files found/i.test(output)) return 'skipped'
  if (/\bTests\s+\d+\s+failed/.test(output) || /Failed Tests\s+\d+/.test(output)) {
    return 'fail'
  }
  return 'infra_error'
}

/** Strip ANSI escapes (defense — we pass --no-color, but reporters vary). */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '')
}

/**
 * Extract a bounded, prompt-ready summary from vitest output: everything from
 * the "Failed Tests" marker when present, else the tail of the output.
 */
export function summarizeTestOutput(output: string, maxChars: number = MAX_SUMMARY_CHARS): string {
  const clean = stripAnsi(output).trim()
  if (!clean) return ''
  const marker = clean.indexOf('Failed Tests')
  const relevant = marker >= 0 ? clean.slice(marker) : clean
  return relevant.length > maxChars ? relevant.slice(-maxChars) : relevant
}

/** The error message fed to the verify-loop repair prompt and the 422 body. */
export function buildTestFailureError(summary: string): string {
  return `Generated tests failed (vitest, run in the session worktree):\n${summary || 'no output captured'}`
}

/**
 * Test-generation instructions appended to the agent system prompt (#341).
 * Kept here (pure module) so prompt content is unit-testable without touching
 * the spawn machinery in claude-agent.ts.
 */
export function buildTestGenerationInstructions(): string {
  return `TESTS (TDD gate — ${WORKTREE_TEST_FILE} WILL be executed with vitest before the app ships):
- ${WORKTREE_TEST_FILE} ALREADY EXISTS with a baseline render smoke test — after src/App.tsx is complete, EDIT it (Edit tool ONLY — never shell commands, never a new file) to cover this app
- Keep the existing pattern: import { describe, it, expect, vi } from 'vitest' (globals are NOT enabled); keep the fetch stub FIRST so any /api/db call is a mocked round-trip
- The test environment is Node with NO DOM: renderToString from 'react-dom/server' only — do NOT use @testing-library, jsdom, document, or window
- CRITICAL: renderToString does NOT run useEffect — only assert content present in the INITIAL render (headings, button labels, static text, empty/loading states). NEVER assert data that only appears after a fetch or effect (fetched rows, seeded sample items, loading-complete states)
- Write 2-4 fast, deterministic tests: (1) renderToString(<App />) returns non-empty HTML without throwing, (2) the HTML contains the app's primary heading and primary action label (both must be visible in the initial render), (3) optionally, a pure helper/calculation exported from App
- Assertions must be timezone-safe and locale-safe: never assert a specific day/month/hour derived from a Date or ISO string (local timezone shifts it) — assert structure instead (non-empty, contains the year, matches a pattern)
- No timers, no real network, no snapshot files — the whole file must run in under 10 seconds`
}

/** Kill switch: CODY_WORKTREE_TESTS=0 disables the gate (default ON, #341). */
export function isWorktreeTestGateEnabled(): boolean {
  return process.env.CODY_WORKTREE_TESTS !== '0'
}

// ---------------------------------------------------------------------------
// Per-chatId outcome store (consulted by ready-gate + chat-ws repair pass)
// ---------------------------------------------------------------------------

interface RecordedResult {
  outcome: WorktreeTestOutcome
  at: number
}

// globalThis-pinned so the record survives Next.js route-module duplication
// (the same pattern the preview stores use). In-memory + TTL: a register-app
// on another instance simply sees no record and fails open — acceptable, the
// gate is defense-in-depth on top of the parse gates.
const g = globalThis as unknown as { __codyWorktreeTestResults?: Map<string, RecordedResult> }
const results: Map<string, RecordedResult> = (g.__codyWorktreeTestResults ||= new Map())

export function recordWorktreeTestResult(chatId: string, outcome: WorktreeTestOutcome): void {
  const now = Date.now()
  // Prune expired entries so the map stays bounded.
  for (const [id, rec] of results) {
    if (now - rec.at > TEST_RESULT_TTL_MS) results.delete(id)
  }
  results.set(chatId, { outcome, at: now })
}

/**
 * Returns the recorded FAILURE for a chatId (within TTL), or null. Pass /
 * skipped / infra outcomes and expired records all yield null — only a real,
 * fresh failing-test run ever blocks readiness.
 */
export function getWorktreeTestFailure(chatId: string): { error: string } | null {
  const rec = results.get(chatId)
  if (!rec) return null
  if (Date.now() - rec.at > TEST_RESULT_TTL_MS) {
    results.delete(chatId)
    return null
  }
  if (rec.outcome.status !== 'fail') return null
  return { error: buildTestFailureError(rec.outcome.summary) }
}

/** Clear the record — called after a successful verify-loop repair. */
export function clearWorktreeTestResult(chatId: string): void {
  results.delete(chatId)
}

// ---------------------------------------------------------------------------
// Runner (impure)
// ---------------------------------------------------------------------------

/**
 * Ensure the worktree can resolve deps: the scaffold never runs npm install,
 * so symlink the builder repo's own node_modules (which has vitest + react)
 * into the worktree. No-op when node_modules already exists.
 */
export async function ensureWorktreeNodeModules(
  worktreePath: string,
  repoRoot: string = process.cwd(),
): Promise<boolean> {
  const target = join(worktreePath, 'node_modules')
  try {
    await access(target)
    return true // already present (real dir or prior symlink)
  } catch {
    /* missing — link it */
  }
  try {
    await symlink(join(repoRoot, 'node_modules'), target, 'dir')
    return true
  } catch {
    return false
  }
}

/**
 * Run ONE generated test file with vitest inside the worktree.
 *
 * Bounded: 60s hard timeout (SIGKILL), output capped, and every infra problem
 * (no runner binary, spawn error, timeout, unclassifiable exit) returns
 * 'infra_error' or 'skipped' — callers treat those as pass-through (fail-open).
 */
export async function runWorktreeTests(
  worktreePath: string,
  testFile: string,
  opts: { timeoutMs?: number; repoRoot?: string } = {},
): Promise<WorktreeTestOutcome> {
  const started = Date.now()
  const timeoutMs = opts.timeoutMs ?? WORKTREE_TEST_TIMEOUT_MS

  const linked = await ensureWorktreeNodeModules(worktreePath, opts.repoRoot)
  if (!linked) {
    return {
      status: 'infra_error',
      testFile,
      summary: 'node_modules unavailable in worktree (symlink failed)',
      durationMs: Date.now() - started,
    }
  }

  const vitestBin = join(worktreePath, 'node_modules', '.bin', 'vitest')
  try {
    await access(vitestBin)
  } catch {
    return {
      status: 'infra_error',
      testFile,
      summary: 'vitest binary not found in linked node_modules',
      durationMs: Date.now() - started,
    }
  }

  return new Promise<WorktreeTestOutcome>((resolve) => {
    let output = ''
    let settled = false
    const finish = (status: WorktreeTestStatus, summary: string) => {
      if (settled) return
      settled = true
      resolve({ status, testFile, summary, durationMs: Date.now() - started })
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(vitestBin, ['run', testFile, '--no-color'], {
        cwd: worktreePath,
        env: { ...process.env, CI: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      finish('infra_error', `spawn failed: ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already dead */
      }
      finish('infra_error', `test run exceeded ${timeoutMs}ms — killed (fail-open)`)
    }, timeoutMs)

    const capture = (chunk: Buffer | string) => {
      if (output.length < MAX_OUTPUT_BYTES) output += chunk.toString()
    }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)

    child.on('error', (err) => {
      clearTimeout(timer)
      finish('infra_error', `runner error: ${err.message}`)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      const status = classifyVitestOutcome(code, output)
      const summary =
        status === 'pass'
          ? summarizeTestOutput(output.split('\n').filter((l) => /Tests\s+\d+ passed/.test(l)).join('\n') || 'tests passed', 200)
          : summarizeTestOutput(output)
      finish(status, summary)
    })
  })
}
