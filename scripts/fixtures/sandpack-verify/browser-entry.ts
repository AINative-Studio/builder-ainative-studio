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
    }
  }
}

const events: Array<{ t: number; type: string; detail?: unknown }> = []

function record(type: string, detail?: unknown) {
  events.push({ t: performance.now(), type, detail })
}

async function run(iframeSelector: string, sandboxSetup: SandboxSetup, options: ClientOptions) {
  record('run:start')
  const client = await loadSandpackClient(iframeSelector, sandboxSetup, options)
  record('client:loaded')

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

window.__sandpackVerify = { run, events }
