/**
 * Coverage-gated verification runner (#372, part of epic #371).
 *
 * Given a generated app's files on disk, runs its OWN test suite with coverage
 * and returns a REAL parsed percentage — never a fabricated or assumed pass.
 * Mirrors the principle in core's issue_resolution_loop.py::_measure_coverage
 * (pytest --cov, parse the real TOTAL line, return None — never a fake number
 * — when it can't be measured), adapted for builder's Node/TypeScript
 * generated apps using `vitest --coverage --reporter=json-summary` (a real
 * machine-readable number, not text-scraping).
 *
 * Confirmed via lib/export/project-exporter.ts's DEFAULT_PACKAGE_JSON: a
 * generated app has NO test script and NO vitest/jest dependency by default —
 * "no tests exist yet" is the overwhelmingly common case, not an edge case.
 * `testable: false` must be the normal, expected result for most callers, not
 * an error path.
 *
 * Deliberately decoupled from Gitea/company-repo: this module only knows about
 * a FileMap on disk. Fetching a company's current repo state and writing it to
 * a temp directory is the CALLER's job (see #374 — task-git-sync wiring).
 */

import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import * as mars from '@/lib/build/mars-sandbox'

export interface FileMap {
  [relativePath: string]: string
}

export interface CoverageResult {
  /** Real parsed coverage percentage (0-100), or null when it genuinely could
   *  not be measured — NEVER a fabricated 0 or 100. */
  coveragePercent: number | null
  /** False when the app has no test script / no test framework installed —
   *  the normal case for a freshly generated app. A caller must NOT gate a
   *  task's completion on coverage when testable is false; the story is
   *  "not testable via code tests," not "failed." */
  testable: boolean
  /** True only when the test command actually ran and exited 0. */
  passed: boolean
  /** Human-readable reason when testable/passed is false — for the task's
   *  durable `output` field (lib/build/task-store.ts), never silently blank. */
  reason?: string
}

/** Reasonable ceiling so a hung generated app's test suite can't hang the
 *  resolver — mirrors core's 120s pytest bound. */
export const RUN_TIMEOUT_MS = 120_000

// ---------------------------------------------------------------------------
// PURE LOGIC (no I/O) — unit-testable directly
// ---------------------------------------------------------------------------

/**
 * Does this generated app's package.json actually declare a way to run
 * coverage? Checks for vitest as a dependency AND a script that invokes it —
 * a generated app with vitest listed but no wired script (or vice versa)
 * isn't genuinely testable. PURE.
 */
export function detectTestCommand(packageJsonRaw: string | undefined): { command: string; args: string[] } | null {
  if (!packageJsonRaw) return null
  let pkg: any
  try {
    pkg = JSON.parse(packageJsonRaw)
  } catch {
    return null
  }
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  const hasVitest = typeof deps?.vitest === 'string'
  const scripts = pkg?.scripts || {}
  // Prefer an explicit coverage script if the generated app defined one;
  // otherwise fall back to invoking vitest directly with --coverage, but
  // ONLY when vitest is actually a declared dependency (never assume a tool
  // that isn't installed will magically be available via npx in a sandboxed
  // run — that would silently download and execute untrusted network code).
  if (typeof scripts['test:coverage'] === 'string' && hasVitest) {
    return { command: 'npx', args: ['vitest', 'run', '--coverage'] }
  }
  if (typeof scripts.test === 'string' && hasVitest) {
    return { command: 'npx', args: ['vitest', 'run', '--coverage'] }
  }
  return null
}

/**
 * Parse vitest's coverage-summary.json content into a real total percentage.
 * Prefers `statements`, falling back to `lines` — matches this repo's own
 * vitest.config.ts threshold shape. Returns null on any malformed/missing
 * shape rather than guessing. PURE.
 */
export function parseCoverageSummary(raw: string | undefined): number | null {
  if (!raw) return null
  let json: any
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const total = json?.total
  const pct = total?.statements?.pct ?? total?.lines?.pct
  if (typeof pct !== 'number' || Number.isNaN(pct)) return null
  return pct
}

// ---------------------------------------------------------------------------
// I/O — isolated from the pure logic above
// ---------------------------------------------------------------------------

/**
 * Write a FileMap to a fresh temp directory. Returns the directory path.
 * Caller is responsible for cleanup (see runCoverage's finally block for the
 * normal path — exposed separately so tests can inspect the written tree).
 */
export async function writeFileMapToTemp(files: FileMap): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'builder-coverage-'))
  for (const [relPath, content] of Object.entries(files)) {
    const clean = relPath.replace(/^\/+/, '')
    const full = path.join(dir, clean)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content, 'utf8')
  }
  return dir
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code, timedOut })
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ exitCode: null, timedOut })
    })
  })
}

/**
 * Tar a local directory into an in-memory Buffer, using `archiver` (already a
 * project dependency, used here for the first time) rather than shelling out
 * to the host `tar` binary. Deliberately NOT using the host `tar` command:
 * live investigation for #875 found that macOS's `tar` silently includes
 * AppleDouble metadata files (`._foo.js`) alongside real files unless
 * `COPYFILE_DISABLE=1` is set — one of those `._foo.test.js` files is enough
 * to make Vite/Rollup crash with a binary-parse error inside the sandbox. A
 * pure-JS archiver never has this problem since it walks exactly the files
 * it's told to add, with no OS-level extended-attribute shadow files.
 */
async function tarDirectory(dir: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const archiver = (await import('archiver')).default
  return new Promise((resolve, reject) => {
    const archive = archiver('tar')
    const chunks: Buffer[] = []
    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('error', reject)
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.directory(dir, false)
    archive.finalize()
  })
}

/**
 * Run the founder's test command inside an isolated M.A.R.S. sandbox session
 * (#875) instead of on Builder's own production server process. Mirrors
 * runLocalCoverage's exact steps and CoverageResult contract — only the I/O
 * layer differs. Session teardown always runs (success or failure) via the
 * outer finally, so a session is never leaked on any exit path.
 */
async function runSandboxedCoverage(
  dir: string,
  testCommand: { command: string; args: string[] },
  timeoutMs: number,
): Promise<CoverageResult> {
  let sessionId: string | null = null
  try {
    const session = await mars.createSandboxSession()
    if (!session) {
      // configured() was true a moment ago but createSandboxSession itself
      // guards it again — null here would only happen on a race with env
      // changing mid-request, effectively never in practice. Fall back to
      // local execution rather than fail outright.
      return runLocalCoverage(dir, testCommand, timeoutMs)
    }
    sessionId = session.sessionId

    const tarBytes = await tarDirectory(dir)
    await mars.uploadArchive(sessionId, 'app', tarBytes)

    const install = await mars.execInSandbox(sessionId, ['npm', 'install', '--no-audit', '--no-fund'], {
      workdir: '/workspace/app',
      timeoutMs,
    })
    if (install.timedOut || install.exitCode !== 0) {
      return {
        coveragePercent: null,
        testable: true,
        passed: false,
        reason: install.timedOut
          ? `npm install timed out after ${timeoutMs}ms (sandboxed)`
          : `npm install failed (exit ${install.exitCode}, sandboxed)`,
      }
    }

    const installCoverageDep = await mars.execInSandbox(
      sessionId,
      ['npm', 'install', '--no-audit', '--no-fund', '--no-save', '@vitest/coverage-v8@3.2.4'],
      { workdir: '/workspace/app', timeoutMs },
    )
    if (installCoverageDep.timedOut || installCoverageDep.exitCode !== 0) {
      return {
        coveragePercent: null,
        testable: true,
        passed: false,
        reason: installCoverageDep.timedOut
          ? `@vitest/coverage-v8 install timed out after ${timeoutMs}ms (sandboxed)`
          : `@vitest/coverage-v8 install failed (exit ${installCoverageDep.exitCode}, sandboxed)`,
      }
    }

    const run = await mars.execInSandbox(
      sessionId,
      [
        testCommand.command,
        ...testCommand.args,
        '--coverage.reportsDirectory=.coverage-output',
        '--coverage.reporter=json-summary',
      ],
      { workdir: '/workspace/app', timeoutMs },
    )

    const summaryBytes = await mars.downloadFile(sessionId, 'app/.coverage-output/coverage-summary.json')
    const coveragePercent = parseCoverageSummary(summaryBytes ? summaryBytes.toString('utf8') : undefined)

    if (run.timedOut) {
      return {
        coveragePercent,
        testable: true,
        passed: false,
        reason: `Test run timed out after ${timeoutMs}ms (sandboxed)`,
      }
    }

    return {
      coveragePercent,
      testable: true,
      passed: run.exitCode === 0,
      reason: run.exitCode === 0 ? undefined : `Test run exited with code ${run.exitCode} (sandboxed)`,
    }
  } finally {
    if (sessionId) {
      await mars.removeSandboxSession(sessionId)
    }
  }
}

/**
 * Run the founder's test command directly on THIS process via local
 * `spawn` — the original, unisolated path. Kept as the fallback for when
 * M.A.R.S. isn't configured (see mars.configured() in runCoverage below) so
 * an environment without DIGITALOCEAN_API_TOKEN set never loses coverage
 * verification entirely — mirrors this repo's "disabled means honest no-op,
 * never a crash" convention used throughout lib/build/*.ts's configured()
 * guards.
 */
async function runLocalCoverage(
  dir: string,
  testCommand: { command: string; args: string[] },
  timeoutMs: number,
): Promise<CoverageResult> {
  const install = await runCommand('npm', ['install', '--no-audit', '--no-fund'], dir, timeoutMs)
  if (install.exitCode !== 0) {
    return {
      coveragePercent: null,
      testable: true,
      passed: false,
      reason: install.timedOut
        ? `npm install timed out after ${timeoutMs}ms`
        : `npm install failed (exit ${install.exitCode})`,
    }
  }

  // vitest's --coverage flag needs @vitest/coverage-v8 as a SEPARATE package
  // (not a transitive dep of vitest itself) — a generated app declaring
  // `vitest` alone (the common case, since we don't control what the
  // codegen step wrote) has no way to actually produce coverage output.
  // Install it explicitly rather than requiring every generated app to have
  // anticipated this; the runner brings what IT needs to do its job.
  const installCoverageDep = await runCommand(
    'npm', ['install', '--no-audit', '--no-fund', '--no-save', '@vitest/coverage-v8@3.2.4'], dir, timeoutMs,
  )
  if (installCoverageDep.exitCode !== 0) {
    return {
      coveragePercent: null,
      testable: true,
      passed: false,
      reason: installCoverageDep.timedOut
        ? `@vitest/coverage-v8 install timed out after ${timeoutMs}ms`
        : `@vitest/coverage-v8 install failed (exit ${installCoverageDep.exitCode})`,
    }
  }

  const coverageDir = path.join(dir, '.coverage-output')
  const run = await runCommand(
    testCommand.command,
    [...testCommand.args, `--coverage.reportsDirectory=${coverageDir}`, '--coverage.reporter=json-summary'],
    dir,
    timeoutMs,
  )

  let summaryRaw: string | undefined
  try {
    summaryRaw = await fs.readFile(path.join(coverageDir, 'coverage-summary.json'), 'utf8')
  } catch {
    summaryRaw = undefined
  }
  const coveragePercent = parseCoverageSummary(summaryRaw)

  if (run.timedOut) {
    return {
      coveragePercent,
      testable: true,
      passed: false,
      reason: `Test run timed out after ${timeoutMs}ms`,
    }
  }

  return {
    coveragePercent,
    testable: true,
    passed: run.exitCode === 0,
    reason: run.exitCode === 0 ? undefined : `Test run exited with code ${run.exitCode}`,
  }
}

/**
 * Run a generated app's own coverage suite against a FileMap and return a
 * REAL result. Never fabricates a coveragePercent — a run that can't produce
 * one (no tests, install failure, timeout, unparseable output) returns null,
 * and the caller (the resolver in #374) must treat that as "cannot verify,"
 * not as an automatic pass or fail.
 *
 * #875 — SECURITY: a founder's own generated test/build code is untrusted
 * and, until now, ran with zero process isolation directly on Builder's own
 * production server (see coverage-runner.ts's module doc comment history /
 * GitHub issue #875 for the full incident writeup). When M.A.R.S. is
 * configured (mars.configured(), i.e. DIGITALOCEAN_API_TOKEN is set), the
 * founder's files and test command run inside a fresh, network-restricted
 * DigitalOcean Managed Agents sandbox session instead — see
 * runSandboxedCoverage. When it is NOT configured, this falls back to the
 * original local-spawn path (runLocalCoverage) so an environment without
 * M.A.R.S. set up (e.g. local dev) never silently loses coverage
 * verification — mirrors this repo's "disabled means honest no-op, never a
 * crash" convention (see lib/git/gitea-client.ts's configured() guard for
 * the same pattern elsewhere).
 */
export async function runCoverage(
  files: FileMap,
  opts: { timeoutMs?: number } = {},
): Promise<CoverageResult> {
  const timeoutMs = opts.timeoutMs ?? RUN_TIMEOUT_MS
  const testCommand = detectTestCommand(files['package.json'] ?? files['/package.json'])
  if (!testCommand) {
    return {
      coveragePercent: null,
      testable: false,
      passed: false,
      reason: 'No vitest dependency + test script found — this app has no coverage-testable suite yet.',
    }
  }

  let dir: string | null = null
  try {
    dir = await writeFileMapToTemp(files)

    if (mars.configured()) {
      try {
        return await runSandboxedCoverage(dir, testCommand, timeoutMs)
      } catch (e) {
        // A genuine M.A.R.S. API/transport failure (outage, auth failure,
        // quota) must not silently fabricate a result — but it also must not
        // permanently break coverage verification for every company just
        // because the sandbox provider had a bad moment. Fall back to local
        // execution for THIS run, with the real reason recorded if the local
        // run also can't produce a result. This mirrors how a local npm
        // install failure already degrades to an honest reason string rather
        // than throwing out of runCoverage entirely.
        try {
          return await runLocalCoverage(dir, testCommand, timeoutMs)
        } catch (localErr) {
          return {
            coveragePercent: null,
            testable: true,
            passed: false,
            reason: `Sandboxed run failed (${e instanceof Error ? e.message : String(e)}) and local fallback also errored: ${localErr instanceof Error ? localErr.message : String(localErr)}`,
          }
        }
      }
    }

    return await runLocalCoverage(dir, testCommand, timeoutMs)
  } catch (e) {
    return {
      coveragePercent: null,
      testable: true,
      passed: false,
      reason: `Coverage run errored: ${e instanceof Error ? e.message : String(e)}`,
    }
  } finally {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
