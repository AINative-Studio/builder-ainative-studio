#!/usr/bin/env -S npx tsx
/**
 * Real end-to-end verification harness for AINative's self-hosted Sandpack
 * bundler stack (issue #1089, epic #1076).
 *
 * WHY THIS EXISTS: #1089 identified that sandpack-bundler's dependency
 * walker has no tree-shaking — importing a single lucide-react icon eagerly
 * transforms lucide-react's entire ~1436-line re-export barrel, every
 * single compile. A real app with several lucide-react icons + several
 * shadcn/ui components (exactly what Builder actually generates) compiles
 * in 30-50s+, blowing well past Builder's 15s SandpackResilientTimeout
 * watchdog (components/chat/sandpack-preview.tsx). Verifying a proposed fix
 * to sandpack-bundler requires re-running the SAME real-browser check
 * (real app renders correctly + zero codesandbox.io/blazingly.io requests +
 * real compile-time measurement + a bounded-failure case) every time a fix
 * is proposed — this script is that check, scripted and reusable, so it
 * doesn't need to be redone by hand in Chrome DevTools each time (as it was,
 * repeatedly, for #1073/#1081/#1082/#1089 before this existed).
 *
 * WHAT IT DOES: drives the REAL integration path — constructs a host page
 * using the REAL `@codesandbox/sandpack-client` npm package (which this
 * repo's own pnpm overrides resolve to AINative's fork,
 * `@ainative/sandpack-client@2.19.8` — see package.json's "overrides" and
 * components/chat/sandpack-preview.tsx's doc comment), bundles it with
 * esbuild, loads it in a real Playwright/Chromium page, and points it at
 * whatever `--bundler-url` is given. This is the exact same postMessage
 * protocol (loadSandpackClient, client.listen for "start"/"done"/
 * action:show-error) that Builder's own production preview already uses —
 * nothing here is a mock or a simulation of the bundler.
 *
 * USAGE:
 *   npx tsx scripts/verify-sandpack-bundler-e2e.ts \
 *     --bundler-url=https://sandpack-bundler-production.up.railway.app \
 *     [--cdn-url=https://sandpack-cdn-production.up.railway.app] \
 *     [--fixture=minimal|realistic|broken-dependency|all] \
 *     [--timeout-ms=60000] \
 *     [--headed] [--json]
 *
 * Defaults: --bundler-url is REQUIRED (no implicit default — this harness
 * must never silently fall back to production without the caller knowing);
 * --cdn-url defaults to the live sandpack-cdn-production deployment and is
 * surfaced in the report for the record, but is NOT passed as a client
 * option — confirmed live, sandpack-client's ClientOptions has no per-call
 * CDN override (only `customNpmRegistries`, a different mechanism for
 * private-registry auth). sandpack-bundler talks to sandpack-cdn itself,
 * server-side, via its OWN deployment's env var — so testing against a
 * non-default CDN means standing up (or pointing) a candidate bundler
 * deployment configured with that CDN URL, then passing that bundler's URL
 * here via --bundler-url. --fixture defaults to "all"; --timeout-ms is the
 * hard per-case wall-clock cutoff (default 60000ms — generous on purpose so
 * a still-broken candidate fails with a real number instead of being killed
 * before it finishes).
 *
 * Exit code: 0 if every case in scope passed its own pass/fail bar (see
 * each case's definition below), 1 otherwise. Always prints a full report
 * regardless of exit code.
 */

import { chromium, type ConsoleMessage, type Page, type Request } from '@playwright/test'
import { createRequire } from 'module'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

import { minimalFixture } from './fixtures/sandpack-verify/minimal'
import { realisticFixture } from './fixtures/sandpack-verify/realistic'
import { brokenDependencyFixture } from './fixtures/sandpack-verify/broken-dependency'
import { buildChatIdFixture } from './fixtures/sandpack-verify/chat-id'
import type { SandpackFixture } from './fixtures/sandpack-verify/types'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface Args {
  bundlerUrl: string
  cdnUrl: string
  fixture: 'minimal' | 'realistic' | 'broken-dependency' | 'all' | 'none'
  timeoutMs: number
  headed: boolean
  json: boolean
  /**
   * Real Builder chatId(s) to pull live via /api/generation/{id}/files and
   * compile against --bundler-url, instead of (or alongside, see --fixture)
   * the synthetic fixtures. Comma-separated for a multi-app sweep (used by
   * the broad real-app spot-check, issue #1089). Each chatId is fetched
   * fresh per run — no local caching — so results always reflect the app's
   * current generated state.
   */
  chatIds: string[]
  builderBaseUrl: string
  /**
   * Enables sandpack-bundler's real profiling instrumentation (PR #5,
   * issue #1089) by appending ?profile=1 to --bundler-url and relaying the
   * resulting sandpack-profile/compile-summary postMessage channels into
   * the report. See browser-entry.ts's profileEntries relay.
   */
  profile: boolean
}

const DEFAULT_CDN_URL = 'https://sandpack-cdn-production.up.railway.app'
/** Matches Builder's own SandpackResilientTimeout watchdog — see
 *  components/chat/sandpack-preview.tsx. Not the harness's hard kill timeout
 *  (--timeout-ms); this is the "would Builder's production watchdog have
 *  given up on this?" threshold used only for the report's verdict column. */
const BUILDER_WATCHDOG_MS = 15_000

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const prefix = `--${flag}=`
    const hit = argv.find((a) => a.startsWith(prefix))
    return hit ? hit.slice(prefix.length) : undefined
  }
  const has = (flag: string): boolean => argv.includes(`--${flag}`)

  const bundlerUrl = get('bundler-url')
  if (!bundlerUrl) {
    console.error(
      '[verify-sandpack-bundler-e2e] ERROR: --bundler-url is required.\n\n' +
        'Example:\n' +
        '  npx tsx scripts/verify-sandpack-bundler-e2e.ts \\\n' +
        '    --bundler-url=https://sandpack-bundler-production.up.railway.app\n'
    )
    process.exit(2)
  }

  // When --chat-id is given and --fixture is NOT explicitly passed, default
  // to running ONLY the real chat-id fixture(s) — a caller asking to test a
  // specific real app almost never also wants the synthetic minimal/
  // realistic/broken-dependency noise mixed into the same report. Passing
  // --fixture explicitly alongside --chat-id still runs both.
  const fixtureExplicit = get('fixture')
  const fixtureArg = fixtureExplicit ?? (argv.some((a) => a.startsWith('--chat-id=')) ? 'none' : 'all')
  if (!['minimal', 'realistic', 'broken-dependency', 'all', 'none'].includes(fixtureArg)) {
    console.error(`[verify-sandpack-bundler-e2e] ERROR: invalid --fixture=${fixtureArg}`)
    process.exit(2)
  }

  const chatIdArg = get('chat-id')
  const chatIds = chatIdArg
    ? chatIdArg
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  return {
    bundlerUrl: bundlerUrl.replace(/\/+$/, '') + '/',
    cdnUrl: (get('cdn-url') ?? DEFAULT_CDN_URL).replace(/\/+$/, ''),
    fixture: fixtureArg as Args['fixture'],
    timeoutMs: Number(get('timeout-ms') ?? 60_000),
    headed: has('headed'),
    json: has('json'),
    chatIds,
    builderBaseUrl: (get('builder-base-url') ?? 'http://localhost:3000').replace(/\/+$/, ''),
    profile: has('profile'),
  }
}

// ---------------------------------------------------------------------------
// Bundling the real @codesandbox/sandpack-client (-> @ainative/sandpack-client
// fork) into something a plain <script> tag can load. No mock: this is the
// exact same package resolved via this repo's pnpm override, bundled with
// esbuild (resolved transitively — this repo doesn't depend on esbuild
// directly, so we walk through a package that does, same trick used to
// resolve sandpack-client itself below).
// ---------------------------------------------------------------------------

function resolveViaDependent<T = unknown>(dependentPkg: string, target: string): string {
  const require = createRequire(import.meta.url)
  const dependentEntry = require.resolve(dependentPkg)
  const scopedRequire = createRequire(dependentEntry)
  return scopedRequire.resolve(target)
}

async function bundleBrowserEntry(repoRoot: string): Promise<string> {
  // @codesandbox/sandpack-client is only a transitive dep (of
  // @codesandbox/sandpack-react) in this repo's pnpm layout — it has no
  // top-level node_modules symlink of its own. Resolve esbuild and the
  // entry's own import of sandpack-client the same way: by walking from a
  // package that already depends on them.
  const esbuildEntry = resolveViaDependent('tsx', 'esbuild')
  const require = createRequire(import.meta.url)
  const esbuild = require(esbuildEntry) as typeof import('esbuild')

  const entryPath = path.join(repoRoot, 'scripts/fixtures/sandpack-verify/browser-entry.ts')

  const result = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    plugins: [
      {
        name: 'resolve-sandpack-client-via-sandpack-react',
        setup(build: import('esbuild').EsbuildPluginBuild) {
          build.onResolve({ filter: /^@codesandbox\/sandpack-client$/ }, () => {
            return { path: resolveViaDependent('@codesandbox/sandpack-react', '@codesandbox/sandpack-client') }
          })
        },
      },
    ],
    define: { 'process.env.NODE_ENV': '"production"' },
  })

  if (!result.outputFiles || result.outputFiles.length === 0) {
    throw new Error('esbuild produced no output bundling scripts/fixtures/sandpack-verify/browser-entry.ts')
  }
  return result.outputFiles[0].text
}

// ---------------------------------------------------------------------------
// Forbidden-domain network tracking
// ---------------------------------------------------------------------------

const FORBIDDEN_DOMAIN_PATTERNS = [/\.codesandbox\.io$/, /\.blazingly\.io$/]

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function isForbiddenHost(host: string | null): boolean {
  if (!host) return false
  return FORBIDDEN_DOMAIN_PATTERNS.some((re) => re.test(host))
}

// ---------------------------------------------------------------------------
// Host page
// ---------------------------------------------------------------------------

function buildHostHtml(bundleJs: string): string {
  // Explicit pixel dimensions, not width/height:100% + position:fixed —
  // confirmed live that the percentage+fixed combo can leave the iframe
  // with a zero/unstable bounding box in Playwright's headless Chromium
  // (html/body have no explicit height of their own to resolve 100%
  // against), which made a REAL, correctly-rendered app falsely report as
  // "expected text not found" — a harness bug, not a bundler bug. A fixed
  // 1200x800 canvas is deterministic regardless of viewport/zoom quirks.
  // Confirmed live: @codesandbox/sandpack-client's loadSandpackClient()
  // does NOT reuse the iframe element passed via iframeSelector — it swaps
  // in a brand-new <iframe> (with no id/name/class of its own) once the
  // bundler's own runtime takes over. A selector tied to the original
  // element's id (`#sandpack-iframe`) therefore stops matching anything
  // the moment that swap happens, even though the real, correctly-rendered
  // app is sitting right there — this looked exactly like "expected text
  // not found" (a correctness failure) when it was actually a harness
  // selector bug. Wrapping the iframe in a container with a STABLE id and
  // selecting the container's first <iframe> child survives the swap,
  // since the wrapper div itself is never touched by sandpack-client.
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>sandpack-bundler verify harness</title>
<style>html,body{margin:0;padding:0;width:1200px;height:800px}</style>
</head>
<body>
  <div id="sandpack-iframe-wrapper" style="width:1200px;height:800px">
    <iframe id="sandpack-iframe" style="width:1200px;height:800px;border:0;display:block"></iframe>
  </div>
  <script>${bundleJs}</script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Case result types
// ---------------------------------------------------------------------------

type Verdict = 'PASS' | 'FAIL'

interface CaseResult {
  fixtureName: string
  kind: 'render' | 'regression'
  verdict: Verdict
  compileMs: number | null
  renderedExpectedText: boolean | null
  forbiddenRequests: string[]
  errorEvents: unknown[]
  timedOut: boolean
  watchdogBand: 'under' | 'close' | 'over' | 'n/a'
  notes: string[]
  /** Only populated when --profile is passed. Raw entries relayed from
   *  sandpack-bundler's babel-worker.ts profileLog / bundler.ts
   *  _transformModule instrumentation. See printProfileSummary(). */
  profileEntries: any[]
}

function watchdogBand(compileMs: number | null): CaseResult['watchdogBand'] {
  if (compileMs === null) return 'n/a'
  if (compileMs < BUILDER_WATCHDOG_MS * 0.7) return 'under'
  if (compileMs <= BUILDER_WATCHDOG_MS) return 'close'
  return 'over'
}

// ---------------------------------------------------------------------------
// Running one fixture
// ---------------------------------------------------------------------------

async function runFixture(
  page: Page,
  fixture: SandpackFixture,
  args: Args,
  kind: 'render' | 'regression'
): Promise<CaseResult> {
  const forbiddenRequests: string[] = []
  const onRequest = (req: Request) => {
    const host = hostOf(req.url())
    if (isForbiddenHost(host)) forbiddenRequests.push(req.url())
  }
  page.on('request', onRequest)

  const notes: string[] = []
  let timedOut = false

  // sandpack-client has no implicit entry inference from bare files — it
  // needs either a package.json "main" or an explicit `entry`, confirmed
  // live: omitting both produces a real, non-hanging client-side error
  // ("entry" was not specified...) that never reaches the bundler at all,
  // which looked like a silent hang in this harness's own first draft
  // before this fix. Every fixture here ships either /src/App.tsx (the
  // "realistic" fixture, which reuses this repo's real Sandpack builtin
  // bundles and their own /src/index.tsx template entry) or a flat
  // /App.tsx (minimal/broken-dependency) that needs a synthesized index
  // file pointing at it, added here rather than baked into the fixture so
  // every fixture file stays a plain, readable React app.
  const files: Record<string, { code: string }> = Object.fromEntries(
    Object.entries(fixture.files).map(([p, code]) => [p, { code }])
  )
  let entry: string
  if (fixture.files['/src/App.tsx']) {
    entry = '/src/index.tsx'
  } else {
    entry = '/index.tsx'
    files['/index.tsx'] = {
      code: `import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
createRoot(document.getElementById('root')!).render(<App />)
`,
    }
    files['/public/index.html'] = {
      code: `<!DOCTYPE html><html><body><div id="root"></div></body></html>`,
    }
  }

  const sandboxSetup = {
    files,
    dependencies: fixture.dependencies,
    entry,
  }

  // --profile appends ?profile=1 to the bundler's own URL — read by
  // sandpack-bundler's src/index.ts at iframe load time to set
  // window.__SANDPACK_PROFILE__ inside that (cross-origin) iframe, the only
  // way a hosting page can toggle it (see that file's doc comment). This is
  // the bundlerURL baked into the iframe src, so appending here reaches the
  // real bundler instance, not a proxy.
  const bundlerUrlForClient = args.profile
    ? args.bundlerUrl + (args.bundlerUrl.includes('?') ? '&' : '?') + 'profile=1'
    : args.bundlerUrl

  const clientOptions = {
    bundlerURL: bundlerUrlForClient,
    logLevel: 30, // Info — enough to surface compile events, not noisy debug
    showOpenInCodeSandbox: false,
  }

  let compileStartPerf: number | null = null
  let compileDonePerf: number | null = null
  let sawErrorEvent: unknown[] = []

  try {
    await page.evaluate(
      async ({ sandboxSetup, clientOptions }) => {
        await window.__sandpackVerify.run('#sandpack-iframe', sandboxSetup, clientOptions)
      },
      { sandboxSetup, clientOptions }
    )

    // Poll the browser-side event log (written by browser-entry.ts) until we
    // see "done" or the hard per-case timeout elapses. This reads the SAME
    // real postMessage event stream Builder's own SandpackResilientTimeout
    // consumes in production — not a synthetic proxy for it.
    const deadline = Date.now() + args.timeoutMs
    while (Date.now() < deadline) {
      const snapshot = await page.evaluate(() => window.__sandpackVerify.events)
      const start = snapshot.find((e) => e.type === 'start')
      const done = snapshot.find((e) => e.type === 'done')
      const errors = snapshot.filter((e) => e.type === 'error')
      if (start && compileStartPerf === null) compileStartPerf = start.t
      if (errors.length > 0) sawErrorEvent = errors.map((e) => e.detail)
      if (done) {
        compileDonePerf = done.t
        break
      }
      if (errors.length > 0) break // bounded-failure case: stop polling, don't wait out the full window
      await page.waitForTimeout(250)
    }
    if (compileDonePerf === null && sawErrorEvent.length === 0) {
      timedOut = true
      notes.push(`No "done" event within ${args.timeoutMs}ms hard harness timeout.`)
    }
  } catch (err) {
    notes.push(`page.evaluate threw: ${err instanceof Error ? err.message : String(err)}`)
  }

  const compileMs =
    compileStartPerf !== null && compileDonePerf !== null ? Math.round(compileDonePerf - compileStartPerf) : null

  // Real chat-id fixtures (scripts/fixtures/sandpack-verify/chat-id.ts) have
  // no harness-friendly data-testid marker baked into real generated app
  // code — expectedText is a sentinel in that case, so skip the DOM-text
  // assertion and score on compile completion + zero errors only, same as
  // every real app actually is scored by Builder's own watchdog in
  // production (SandpackResilientTimeout never checks DOM text either).
  const isChatIdFixture = fixture.expectedText === '__CHAT_ID_FIXTURE_NO_TEXT_ASSERTION__'

  let renderedExpectedText: boolean | null = null
  if (kind === 'render' && compileDonePerf !== null && !isChatIdFixture) {
    try {
      // Scope through the wrapper div's first iframe child, not an id
      // selector on the iframe itself — see buildHostHtml()'s doc comment:
      // sandpack-client swaps in a fresh iframe with no id of its own.
      const frame = page.frameLocator('#sandpack-iframe-wrapper iframe')
      await frame.locator(`text=${fixture.expectedText}`).waitFor({ timeout: 8_000 })
      renderedExpectedText = true
    } catch {
      renderedExpectedText = false
      notes.push(`Expected text "${fixture.expectedText}" not found in rendered iframe DOM.`)
    }
  }

  let profileEntries: any[] = []
  if (args.profile) {
    try {
      profileEntries = await page.evaluate(() => window.__sandpackVerify.profileEntries)
    } catch {
      notes.push('Failed to read profileEntries from page — --profile may not be wired for this bundler version.')
    }
  }

  page.off('request', onRequest)

  // Verdict rules:
  //  - render case: PASS iff rendered real content, zero forbidden requests,
  //    no error events, didn't time out. Compile time itself is reported as
  //    a number, not folded into pass/fail — correctness and speed are
  //    reported separately per the task brief.
  //  - regression case: PASS iff it failed BOUNDED (surfaced an error event
  //    OR the client itself rejected) within the timeout window, rather than
  //    hanging silently with no "done" and no error until the hard timeout.
  let verdict: Verdict
  if (kind === 'regression') {
    verdict = sawErrorEvent.length > 0 && !timedOut ? 'PASS' : 'FAIL'
    if (verdict === 'FAIL' && timedOut) {
      notes.push('Broken-dependency case HUNG past the timeout with no surfaced error — this is the exact silent-hang failure mode the regression case exists to catch.')
    }
  } else if (isChatIdFixture) {
    verdict = compileDonePerf !== null && forbiddenRequests.length === 0 && sawErrorEvent.length === 0 && !timedOut
      ? 'PASS'
      : 'FAIL'
  } else {
    verdict =
      renderedExpectedText === true && forbiddenRequests.length === 0 && sawErrorEvent.length === 0 && !timedOut
        ? 'PASS'
        : 'FAIL'
  }

  return {
    fixtureName: fixture.name,
    kind,
    verdict,
    compileMs,
    renderedExpectedText,
    forbiddenRequests,
    errorEvents: sawErrorEvent,
    timedOut,
    watchdogBand: kind === 'render' ? watchdogBand(compileMs) : 'n/a',
    notes,
    profileEntries,
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function bandLabel(band: CaseResult['watchdogBand']): string {
  switch (band) {
    case 'under':
      return 'comfortably under 15s watchdog'
    case 'close':
      return 'close to 15s watchdog'
    case 'over':
      return 'OVER 15s watchdog — would trip SandpackResilientTimeout in production'
    default:
      return 'n/a'
  }
}

/**
 * Aggregate raw profileLog entries (per babel.transform() call) into a
 * human-readable breakdown: total calls, cache hit rate, time spent on
 * node_modules vs app source, and the heaviest individual packages by
 * summed transform time (filepath's node_modules/<pkg>/... prefix is used
 * to bucket by package). This is the real evidence behind any root-cause
 * claim this harness makes — not a guess.
 */
function printProfileSummary(entries: any[]) {
  const transformEntries = entries.filter((e) => e && typeof e.totalMs === 'number')
  if (transformEntries.length === 0) return

  let nodeModuleCalls = 0
  let appCalls = 0
  let nodeModuleMs = 0
  let appMs = 0
  let cacheHits = 0
  const byPackage = new Map<string, { calls: number; ms: number }>()

  for (const e of transformEntries) {
    const ms = e.totalMs as number
    if (e.isNodeModule) {
      nodeModuleCalls++
      nodeModuleMs += ms
      if (e.cacheHit) cacheHits++
      const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(e.filepath ?? '')
      const pkg = m ? m[1] : 'unknown'
      const bucket = byPackage.get(pkg) ?? { calls: 0, ms: 0 }
      bucket.calls++
      bucket.ms += ms
      byPackage.set(pkg, bucket)
    } else {
      appCalls++
      appMs += ms
    }
  }

  console.log(`       --- profile summary ---`)
  console.log(
    `       babel.transform() calls: ${transformEntries.length} total (${nodeModuleCalls} node_modules, ${appCalls} app source)`
  )
  console.log(
    `       node_modules time: ${nodeModuleMs.toFixed(0)}ms across ${nodeModuleCalls} calls (cache hits: ${cacheHits}/${nodeModuleCalls})`
  )
  console.log(`       app source time: ${appMs.toFixed(0)}ms across ${appCalls} calls`)
  const topPackages = Array.from(byPackage.entries())
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 10)
  if (topPackages.length > 0) {
    console.log(`       top packages by summed transform time:`)
    for (const [pkg, stat] of topPackages) {
      console.log(`         ${pkg}: ${stat.ms.toFixed(0)}ms (${stat.calls} files)`)
    }
  }
}

function printReport(results: CaseResult[], args: Args) {
  if (args.json) {
    console.log(JSON.stringify({ bundlerUrl: args.bundlerUrl, cdnUrl: args.cdnUrl, results }, null, 2))
    return
  }

  console.log('')
  console.log('='.repeat(78))
  console.log('sandpack-bundler E2E verification report')
  console.log('='.repeat(78))
  console.log(`bundler-url: ${args.bundlerUrl}`)
  console.log(`cdn-url:     ${args.cdnUrl}`)
  console.log(`watchdog:    Builder's SandpackResilientTimeout = ${BUILDER_WATCHDOG_MS}ms`)
  console.log('')

  for (const r of results) {
    const icon = r.verdict === 'PASS' ? 'PASS' : 'FAIL'
    console.log(`[${icon}] ${r.fixtureName} (${r.kind})`)
    if (r.kind === 'render') {
      console.log(
        `       compile time: ${r.compileMs !== null ? `${r.compileMs}ms` : 'n/a (never completed)'}  —  ${bandLabel(r.watchdogBand)}`
      )
      console.log(`       rendered expected content: ${r.renderedExpectedText}`)
    } else {
      console.log(`       bounded failure (not a hang): ${r.verdict === 'PASS'}`)
    }
    console.log(`       zero codesandbox.io/blazingly.io requests: ${r.forbiddenRequests.length === 0}`)
    if (r.forbiddenRequests.length > 0) {
      for (const u of r.forbiddenRequests.slice(0, 5)) console.log(`         ! ${u}`)
    }
    if (r.errorEvents.length > 0) {
      console.log(`       error events seen: ${r.errorEvents.length}`)
    }
    for (const n of r.notes) console.log(`       note: ${n}`)
    if (args.profile && r.profileEntries.length > 0) {
      printProfileSummary(r.profileEntries)
    }
    console.log('')
  }

  const allPass = results.every((r) => r.verdict === 'PASS')
  console.log('-'.repeat(78))
  console.log(allPass ? 'OVERALL: PASS — fix works and is correctness-verified.' : 'OVERALL: FAIL — see cases above.')
  const renderCases = results.filter((r) => r.kind === 'render')
  if (renderCases.length > 0) {
    const overBudget = renderCases.filter((r) => r.watchdogBand === 'over')
    if (overBudget.length > 0) {
      console.log(
        `PERFORMANCE: ${overBudget.length}/${renderCases.length} render case(s) exceed the 15s watchdog (${overBudget
          .map((r) => `${r.fixtureName}=${r.compileMs}ms`)
          .join(', ')}). NOT fast enough for production yet, even if correct.`
      )
    } else {
      console.log('PERFORMANCE: all render cases comfortably within the 15s watchdog.')
    }
  }
  console.log('='.repeat(78))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

  console.error(`[verify-sandpack-bundler-e2e] bundling real @codesandbox/sandpack-client (-> AINative fork) via esbuild...`)
  const bundleJs = await bundleBrowserEntry(repoRoot)

  const hostHtmlPath = path.join(os.tmpdir(), `sandpack-verify-host-${Date.now()}.html`)
  fs.writeFileSync(hostHtmlPath, buildHostHtml(bundleJs), 'utf-8')

  const fixturesToRun: Array<{ fixture: SandpackFixture; kind: 'render' | 'regression' }> = []
  if (args.fixture === 'all' || args.fixture === 'minimal') fixturesToRun.push({ fixture: minimalFixture, kind: 'render' })
  if (args.fixture === 'all' || args.fixture === 'realistic') fixturesToRun.push({ fixture: realisticFixture, kind: 'render' })
  if (args.fixture === 'all' || args.fixture === 'broken-dependency')
    fixturesToRun.push({ fixture: brokenDependencyFixture, kind: 'regression' })

  for (const chatId of args.chatIds) {
    console.error(`[verify-sandpack-bundler-e2e] fetching real app files for chatId=${chatId} from ${args.builderBaseUrl}...`)
    try {
      const fixture = await buildChatIdFixture(chatId, args.builderBaseUrl)
      fixturesToRun.push({ fixture, kind: 'render' })
    } catch (err) {
      console.error(`[verify-sandpack-bundler-e2e] FAILED to build fixture for chatId=${chatId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.error(`[verify-sandpack-bundler-e2e] launching Chromium (headed=${args.headed})...`)
  const browser = await chromium.launch({ headless: !args.headed })
  const results: CaseResult[] = []

  try {
    for (const { fixture, kind } of fixturesToRun) {
      const page = await browser.newPage()
      page.on('console', (msg: ConsoleMessage) => {
        if (msg.type() === 'error') console.error(`  [browser console] ${msg.text()}`)
      })
      page.on('pageerror', (err: Error) => {
        // Debug aid (issue #1089): React's error-boundary console.error
        // only logs a generic "above error occurred in <X>" wrapper
        // message via msg.text() -- the actual thrown exception (what
        // really failed and why) is a separate, real uncaught error.
        // 'pageerror' captures that directly, bypassing React's logging
        // entirely.
        console.error(`  [page error] ${err.message}\n${err.stack ?? ''}`)
      })
      console.error(`[verify-sandpack-bundler-e2e] running fixture "${fixture.name}"...`)
      await page.goto(`file://${hostHtmlPath}`)
      const result = await runFixture(page, fixture, args, kind)
      results.push(result)
      console.error(
        `[verify-sandpack-bundler-e2e]   -> ${result.verdict} (compile=${result.compileMs ?? 'n/a'}ms, timedOut=${result.timedOut})`
      )
      await page.close()
    }
  } finally {
    await browser.close()
    fs.rmSync(hostHtmlPath, { force: true })
  }

  printReport(results, args)
  process.exit(results.every((r) => r.verdict === 'PASS') ? 0 : 1)
}

main().catch((err) => {
  console.error('[verify-sandpack-bundler-e2e] FATAL:', err)
  process.exit(1)
})
