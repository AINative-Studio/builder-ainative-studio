'use client'

import React from 'react'
import {
  SandpackProvider,
  SandpackPreview as SandpackPreviewComponent,
  SandpackLayout,
  useSandpack,
} from '@codesandbox/sandpack-react'
import { cn } from '@/lib/utils'
import { buildSandpackFiles, detectSandpackDependencies } from '@/lib/sandpack/build-files'

/**
 * #1074 (epic #1076): the underlying `@codesandbox/sandpack-client` dependency
 * is now resolved via a pnpm override (see root package.json) to AINative's
 * fork (`@ainative/sandpack-client`, carrying the self-hosted-CDN fixes from
 * issue #1073 — see that PR and builder-ainative-studio#1073's closing
 * comment for the real, browser-verified evidence that fork renders
 * correctly). That fork's own BUILT-IN default bundler origin is
 * `https://sandpack{{suffix}}.ainative.studio/` — a placeholder host that
 * does NOT yet serve a real, deployed bundler (the actual iframe build,
 * `sandpack-bundler` PR AINative-Studio/sandpack-bundler#2, is open but not
 * yet deployed anywhere stable). Silently inheriting that default here would
 * break 100% of multi-file previews on merge, not just prepare the ground
 * for a later cutover.
 *
 * So: explicitly pin `bundlerURL` to the exact host Builder's previews are
 * already using in production today (verified live, 2026-10-13 —
 * `2-19-8-sandpack.codesandbox.io`, matching the currently-pinned
 * `@codesandbox/sandpack-react@^2.20.0` / sandpack-client@2.19.8 version
 * line) UNLESS `NEXT_PUBLIC_SANDPACK_BUNDLER_URL` is explicitly set. This
 * makes the dependency swap itself behavior-neutral — real preview traffic
 * keeps hitting the known-good CodeSandbox host exactly as before — while
 * leaving a one-env-var cutover (no further code change, no redeploy of
 * this file) once a real self-hosted bundler is live and verified at scale.
 * Do NOT remove this override as part of a later "cleanup" without first
 * confirming a real self-hosted bundler is deployed, stable, and the env
 * var is set — see builder-ainative-studio#1074 and #1076 for the rollout
 * plan.
 */
const STOCK_CODESANDBOX_BUNDLER_URL = 'https://2-19-8-sandpack.codesandbox.io/'
const SANDPACK_BUNDLER_URL =
  process.env.NEXT_PUBLIC_SANDPACK_BUNDLER_URL || STOCK_CODESANDBOX_BUNDLER_URL

/**
 * Real production reliability gap, confirmed live (2026-10-12): Sandpack's
 * bundler-side dependency fetch (from unpkg.com) can hang indefinitely with
 * NO error event, NO timeout, and NO visible failure state — the preview
 * iframe is created but never given a real src, and the page just stays
 * blank forever. This is a known, unfixed CodeSandbox/unpkg reliability gap
 * (github.com/codesandbox/sandpack/issues/703, discussions/706 — a
 * maintainer confirms "possible... a hiccup due to some UNPKG issues", no
 * official fix exists 3+ years later).
 *
 * SandpackResilientTimeout listens for Sandpack's own "start"/"done" events
 * (the same stream useSandpackPreviewProgress reads) and calls onTimeout if
 * "done" never fires within `timeoutMs` of the first "start". Must render
 * INSIDE SandpackProvider (useSandpack() requires that context).
 *
 * Second real gap, confirmed live 2026-10-15 on real founder apps (Vaultn,
 * Voya, Pulsar — all rendering blank on builder.ainative.studio/build/{slug}
 * after the self-hosted bundler cutover): the ORIGINAL version of this
 * watchdog only armed its timer once a "start" message arrived — but on the
 * self-hosted bundler, the compile handshake sometimes never begins at all
 * (confirmed via browser network inspection: zero requests to the bundler
 * origin, zero console errors, zero Sandpack lifecycle events of any kind).
 * "start" never fires, so the timer that only arms ON "start" never arms
 * either, and the page is stuck blank forever with no fallback — strictly
 * worse than the already-documented post-start hang this watchdog was built
 * to catch, since that one at least left a "start" event the old code could
 * key off of. Fix: also arm an unconditional fallback timer on mount, so a
 * compile that never even starts is caught the same way a compile that
 * starts-but-never-finishes already was. The "start"-triggered timer is kept
 * as the primary path when it does fire, since it's a tighter, more
 * accurate countdown than "from mount" when the handshake itself takes a
 * little while to begin under real network conditions.
 */
function SandpackResilientTimeout({ timeoutMs, onTimeout }: { timeoutMs: number; onTimeout: () => void }) {
  const { listen } = useSandpack()
  const firedRef = React.useRef(false)

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const clear = () => { if (timer) clearTimeout(timer) }
    const arm = (reason: 'start' | 'mount') => {
      clear()
      timer = setTimeout(() => {
        if (!firedRef.current) {
          firedRef.current = true
          console.warn(
            reason === 'start'
              ? `[SandpackPreview] No "done" event within ${timeoutMs}ms of start — treating as hung, falling back`
              : `[SandpackPreview] No "start" event within ${timeoutMs}ms of mount — compile never began, treating as hung, falling back`
          )
          onTimeout()
        }
      }, timeoutMs)
    }

    // Unconditional fallback: catches a compile that never even starts
    // (the self-hosted-bundler gap above). Re-armed with the tighter
    // "start"-based countdown below if/when a real "start" does arrive.
    arm('mount')

    const unsubscribe = listen((message) => {
      if (message.type === 'console') {
        console.log('[SandpackDiag3] console relay:', JSON.stringify(message))
      }
      if (message.type === 'start') {
        arm('start')
      }
      if (message.type === 'done') {
        firedRef.current = true
        clear()
      }
    })

    return () => {
      clear()
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

class SandpackErrorBoundary extends React.Component<
  { children: React.ReactNode; className?: string },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className={cn('flex items-center justify-center h-full bg-red-50 dark:bg-red-950 p-6', this.props.className)}>
          <div className="text-center max-w-md">
            <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">Preview failed to render</p>
            <p className="text-xs text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap break-all">
              {this.state.error.message?.slice(0, 300) || 'Syntax error in generated code'}
            </p>
            <button
              className="mt-4 px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-800"
              onClick={() => this.setState({ error: null })}
            >
              Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

interface SandpackPreviewProps {
  files: Record<string, string>
  theme?: 'light' | 'dark'
  className?: string
  /** #1068: off for non-interactive thumbnail uses (ShowcaseThumbnail) where
   *  Sandpack's own refresh control would show through a pointer-events:none
   *  scaled-down card. Defaults to true — unchanged for every existing caller. */
  showRefreshButton?: boolean
  /** Real preview-system resilience gap found live: Sandpack's bundler-side
   *  dependency fetch can hang forever with no error (unfixed CodeSandbox/
   *  unpkg issue, see SandpackResilientTimeout's doc comment above). When
   *  set, onTimeout fires once if Sandpack hasn't finished within timeoutMs
   *  of starting — the caller is expected to swap to a non-Sandpack fallback
   *  (e.g. the flattened-code iframe). Omit to disable the watchdog (keeps
   *  existing behavior for any caller that doesn't opt in). */
  timeoutMs?: number
  onTimeout?: () => void
}

export function SandpackPreview({ files, theme = 'light', className, showRefreshButton = true, timeoutMs, onTimeout }: SandpackPreviewProps) {
  // Build the final Sandpack files map (builtins + generated files, path
  // normalization, /App.tsx entry assembly, React/AIKit/shadcn/lucide
  // import-injection safety nets, final de-dupe) via the shared pipeline in
  // lib/sandpack/build-files.ts — see that file's doc comment for why this
  // is extracted rather than inlined (keeps scripts/fixtures/sandpack-verify's
  // --chat-id harness from drifting out of sync with what this component
  // actually does).
  const sandpackFiles = buildSandpackFiles(files)
  const { usesLucideReact, usesRecharts } = detectSandpackDependencies(sandpackFiles)

  if (sandpackFiles['/App.tsx']) {
    const mainCode = sandpackFiles['/App.tsx']
    console.log('[SandpackPreview] App.tsx:', mainCode.length, 'chars,', mainCode.split('\n').length, 'lines')
    console.log('[SandpackPreview] Has return+JSX:', mainCode.includes('return') && mainCode.includes('<div'))
    console.log('[SandpackPreview] Has export default:', mainCode.includes('export default'))
    console.log('[SandpackPreview] Last 3 lines:', mainCode.split('\n').slice(-3).join(' | '))
    console.log('[SandpackPreview] POST-FIX App.tsx:', mainCode.length, 'chars,', mainCode.split('\n').length, 'lines')
    console.log('[SandpackPreview] POST-FIX last 3:', mainCode.split('\n').slice(-3).join(' | '))
  }

  return (
    <div className={cn('w-full h-full flex flex-col', className)} style={{ minHeight: 0 }}>
      <SandpackErrorBoundary className="flex-1">
      <SandpackProvider
        template="react-ts"
        files={sandpackFiles}
        customSetup={{
          dependencies: {
            // react/react-dom/prop-types pinned explicitly (not just left to
            // Sandpack's auto-resolution from source imports) — unpinned,
            // Sandpack resolves "latest matching" at request time, which can
            // land on a version its own bundler-side fetch hangs on with no
            // error (confirmed live: react@18.3.1/react-dom@18.3.1/
            // prop-types@15.8.1 — Sandpack's auto-resolved pins at the time —
            // never resolved inside Sandpack's bundler, even though the same
            // exact unpkg URLs respond in well under a second to a direct
            // fetch; this is a known, acknowledged, UNFIXED CodeSandbox/
            // unpkg reliability gap: github.com/codesandbox/sandpack/
            // issues/703, discussions/706). Pinning to a fixed, specific
            // version makes the dependency resolution deterministic — not a
            // moving target re-resolved on every load — and this is paired
            // with a hard render timeout (SandpackResilientTimeout, below)
            // that falls back to the existing iframe path if Sandpack still
            // hangs regardless of version. That fallback is the real fix;
            // the pin just reduces how often it's needed.
            react: '18.2.0',
            'react-dom': '18.2.0',
            'prop-types': '15.8.1',
            ...(usesLucideReact ? { 'lucide-react': '0.344.0' } : {}),
            ...(usesRecharts ? { 'recharts': '2.15.0' } : {}),
            'clsx': '2.1.0',
            'tailwind-merge': '2.2.0',
          },
        }}
        options={{
          // Tailwind's CDN script is loaded directly in the HTML shell now
          // (lib/sandpack/setup.ts's /public/index.html), as a blocking
          // <script> tag that executes before React mounts — NOT here via
          // externalResources, which injects it asynchronously AFTER the
          // shell loads and races against the React render. See that file's
          // doc comment for the full investigation (9/23 real companies
          // found rendering unstyled, 2026-10-19).
          activeFile: '/App.tsx',
          bundlerURL: SANDPACK_BUNDLER_URL,
        }}
        theme={theme === 'dark' ? 'dark' : 'light'}
      >
        {timeoutMs !== undefined && onTimeout && (
          <SandpackResilientTimeout timeoutMs={timeoutMs} onTimeout={onTimeout} />
        )}
        <SandpackLayout
          style={{
            height: '100%',
            border: 'none',
            borderRadius: 0,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SandpackPreviewComponent
            showNavigator={false}
            showRefreshButton={showRefreshButton}
            showOpenInCodeSandbox={false}
            style={{ flex: 1, height: '100%' }}
          />
        </SandpackLayout>
      </SandpackProvider>
      </SandpackErrorBoundary>
    </div>
  )
}
