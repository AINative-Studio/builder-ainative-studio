/**
 * Browser entry point bundled (via esbuild, in-memory) by
 * scripts/verify-sandpack-bundler-e2e.ts into a host page it serves to
 * Playwright. Exposes the REAL @ainative/sandpack-client npm package (not a
 * mock — resolved through the @codesandbox/sandpack-client pnpm alias
 * exactly as components/chat/sandpack-preview.tsx does) as
 * `window.__sandpackVerify` so the Node-side harness can drive it, listen
 * for the real "start"/"done"/error postMessage protocol, and report real
 * wall-clock compile time.
 */
import { loadSandpackClient } from '@codesandbox/sandpack-client'
import type { ClientOptions, SandboxSetup } from '@codesandbox/sandpack-client'

declare global {
  interface Window {
    __sandpackVerify: {
      run: (
        iframeSelector: string,
        sandboxSetup: SandboxSetup,
        options: ClientOptions
      ) => Promise<void>
      events: Array<{ t: number; type: string; detail?: unknown }>
      profileEntries: unknown[]
    }
  }
}

const events: Array<{ t: number; type: string; detail?: unknown }> = []
// AINative perf-profiling instrumentation (issue builder-ainative-studio#1089).
// Real babel-transform / module-registry profiling relayed by the live
// bundler (see sandpack-bundler's src/index.ts handleCompile,
// src/bundler/bundler.ts _transformModule, src/bundler/transforms/babel/
// babel-worker.ts profileLog) over the SAME postMessage channel the real
// iframe already uses — this harness just forwards it onto
// window.__sandpackVerify.profileEntries so the Node-side script can read
// it back via page.evaluate, same mechanism as `events` above.
const profileEntries: unknown[] = []

function record(type: string, detail?: unknown) {
  events.push({ t: performance.now(), type, detail })
}

async function run(iframeSelector: string, sandboxSetup: SandboxSetup, options: ClientOptions) {
  record('run:start')
  const client = await loadSandpackClient(iframeSelector, sandboxSetup, options)
  record('client:loaded')

  // Relay sandpack-profile / compile-summary channel messages straight from
  // the iframe's raw postMessage stream — client.listen() only surfaces the
  // bundler's own protocol event types ("start"/"done"/"action"), not these
  // extra debug channels, so they have to be read directly off window
  // message events targeting the iframe's contentWindow.
  window.addEventListener('message', (evt: MessageEvent) => {
    const data = evt.data as { channel?: string; entries?: unknown[]; __sandpackProfile?: string } | undefined
    if (!data || typeof data !== 'object') return
    if (data.channel === 'sandpack-profile' && Array.isArray(data.entries)) {
      profileEntries.push(...data.entries)
    } else if (data.__sandpackProfile === 'compile-summary') {
      profileEntries.push({ kind: 'compile-summary', ...data })
    }
  })

  client.listen((message: { type: string } & Record<string, unknown>) => {
    // Mirrors the exact event stream SandpackResilientTimeout
    // (components/chat/sandpack-preview.tsx) already listens to in
    // production: "start" begins a compile, "done" ends it, "action" with
    // action:"show-error" surfaces a compile/runtime error.
    if (message.type === 'action' && (message as { action?: string }).action === 'show-error') {
      record('error', message)
    } else {
      record(message.type, message)
    }
  })
}

window.__sandpackVerify = { run, events, profileEntries }
