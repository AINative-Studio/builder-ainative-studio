import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'
import { sandpackDbTokenShim } from '@/lib/sandpack/db-token-shim'

/**
 * #1561 — buildSandpackFiles()'s optional shim injection: when given
 * {origin, dbToken}, it must add /db-token-shim.ts to the file map AND make
 * /index.tsx import it FIRST (before the real app's own `import App from
 * './App'`), so window.fetch is patched before any of the generated app's
 * own code can call it.
 */
describe('buildSandpackFiles — db-token-shim injection (#1561)', () => {
  it('without shim options, behaves exactly as before (no shim file, no index.tsx change)', () => {
    const built = buildSandpackFiles({ '/App.tsx': "export default function App(){ return <div/> }" })
    expect(built['/db-token-shim.ts']).toBeUndefined()
    expect(built['/index.tsx']).not.toContain('db-token-shim')
  })

  it('with a real origin+token, injects /db-token-shim.ts with the real rewrite+auth logic', () => {
    const built = buildSandpackFiles(
      { '/App.tsx': "export default function App(){ return <div/> }" },
      { origin: 'https://builder.ainative.studio', dbToken: 'real-signed-token' },
    )
    expect(built['/db-token-shim.ts']).toBeDefined()
    expect(built['/db-token-shim.ts']).toContain('https://builder.ainative.studio')
    expect(built['/db-token-shim.ts']).toContain('real-signed-token')
  })

  it('imports the shim FIRST in /index.tsx, before the template\'s own App import', () => {
    const built = buildSandpackFiles(
      { '/App.tsx': "export default function App(){ return <div/> }" },
      { origin: 'https://builder.ainative.studio', dbToken: 'real-signed-token' },
    )
    const index = built['/index.tsx']
    expect(index.indexOf("import './db-token-shim'")).toBe(0)
    expect(index.indexOf("import './db-token-shim'")).toBeLessThan(index.indexOf("import App from './App'"))
  })

  it('missing just the token still behaves as the no-shim case (never injects a broken/empty shim)', () => {
    const built = buildSandpackFiles(
      { '/App.tsx': "export default function App(){ return <div/> }" },
      { origin: 'https://builder.ainative.studio', dbToken: '' },
    )
    expect(built['/db-token-shim.ts']).toBeUndefined()
  })

  it('missing just the origin also declines to inject', () => {
    const built = buildSandpackFiles(
      { '/App.tsx': "export default function App(){ return <div/> }" },
      { origin: '', dbToken: 'real-signed-token' },
    )
    expect(built['/db-token-shim.ts']).toBeUndefined()
  })
})

/**
 * sandpackDbTokenShim itself — executed as a real module in jsdom, same
 * methodology as dbTokenShim's own test file (preview-db-token-shim.test.ts)
 * executing the REAL generated script rather than reimplementing its logic.
 */
describe('sandpackDbTokenShim — the real generated module, executed', () => {
  function runShimModule(source: string) {
    // Strip the ES module `export {}` tail — this test runs the body as a
    // plain script via new Function, not through a real module loader.
    const body = source.replace(/export\s*\{\s*\}\s*;?\s*$/m, '')
    const captured: { url?: string; headers?: Headers } = {}
    const originalFetch = (globalThis as any).fetch
    ;(globalThis as any).window = globalThis
    window.fetch = ((input: any, init?: RequestInit) => {
      captured.url = typeof input === 'string' ? input : input?.url
      captured.headers = new Headers(init?.headers)
      return Promise.resolve(new Response('{}'))
    }) as any
    // eslint-disable-next-line no-new-func
    new Function(body).call(window)
    return { captured, restore: () => { window.fetch = originalFetch } }
  }

  it('rewrites a relative /api/db URL to the absolute origin and attaches the token header', async () => {
    const source = sandpackDbTokenShim('https://builder.ainative.studio', 'real-token-123')
    const { captured, restore } = runShimModule(source)
    await window.fetch('/api/db/silos', { method: 'POST' })
    expect(captured.url).toBe('https://builder.ainative.studio/api/db/silos')
    expect(captured.headers?.get('x-ainative-db-token')).toBe('real-token-123')
    restore()
  })

  it('leaves an unrelated path untouched (no rewrite, no header)', async () => {
    const source = sandpackDbTokenShim('https://builder.ainative.studio', 'real-token-123')
    const { captured, restore } = runShimModule(source)
    await window.fetch('/some-other-path')
    expect(captured.url).toBe('/some-other-path')
    expect(captured.headers?.get('x-ainative-db-token')).toBeNull()
    restore()
  })

  it('with no origin/token, produces an inert no-op module', () => {
    expect(sandpackDbTokenShim('', '')).toBe('export {}\n')
  })
})

/**
 * #2135 — the deterministic visitor-tracking beacon sandpackDbTokenShim also
 * fires on import when given a chatId, independent of whether the generated
 * app's own code ever calls /api/db/visitors itself. See that file's doc
 * comment for the full root-cause writeup (every Sandpack-rendered company
 * on the shared ZeroDB project can never have its pageview correctly
 * attributed via window.location.pathname from inside the bundler's iframe).
 */
describe('sandpackDbTokenShim — #2135 visitor-tracking beacon', () => {
  function runShimModule(source: string) {
    const body = source.replace(/export\s*\{\s*\}\s*;?\s*$/m, '')
    const calls: { url: string; init?: RequestInit }[] = []
    const originalFetch = (globalThis as any).fetch
    ;(globalThis as any).window = globalThis
    window.fetch = ((input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input?.url
      calls.push({ url, init })
      return Promise.resolve(new Response('{}'))
    }) as any
    // eslint-disable-next-line no-new-func
    new Function(body).call(window)
    return { calls, restore: () => { window.fetch = originalFetch } }
  }

  it('without a chatId, fires no beacon at all (unchanged #1561 behavior)', () => {
    const source = sandpackDbTokenShim('https://builder.ainative.studio', 'real-token-123')
    const { calls, restore } = runShimModule(source)
    expect(calls).toHaveLength(0)
    restore()
  })

  it('with a chatId, fires exactly one POST to /api/db/visitors on import, with the real token header and a path containing the chatId', () => {
    const source = sandpackDbTokenShim('https://builder.ainative.studio', 'real-token-123', 'abc123XYZ')
    const { calls, restore } = runShimModule(source)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://builder.ainative.studio/api/db/visitors')
    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get('x-ainative-db-token')).toBe('real-token-123')
    expect(headers.get('Content-Type')).toBe('application/json')
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.path).toContain('abc123XYZ')
    expect(typeof body.ts).toBe('string')
    restore()
  })

  it('a beacon fetch rejection never throws out of module import (best-effort)', () => {
    const source = sandpackDbTokenShim('https://builder.ainative.studio', 'real-token-123', 'abc123XYZ')
    const body = source.replace(/export\s*\{\s*\}\s*;?\s*$/m, '')
    ;(globalThis as any).window = globalThis
    const originalFetch = (globalThis as any).fetch
    window.fetch = (() => Promise.reject(new Error('network down'))) as any
    // eslint-disable-next-line no-new-func
    expect(() => new Function(body).call(window)).not.toThrow()
    window.fetch = originalFetch
  })
})

describe('buildSandpackFiles — threads chatId into the injected shim (#2135)', () => {
  it('passes shim.chatId through to the generated /db-token-shim.ts', () => {
    const built = buildSandpackFiles(
      { '/App.tsx': "export default function App(){ return <div/> }" },
      { origin: 'https://builder.ainative.studio', dbToken: 'real-signed-token', chatId: 'myChatId123' },
    )
    expect(built['/db-token-shim.ts']).toContain('myChatId123')
    expect(built['/db-token-shim.ts']).toContain('/api/db/visitors')
  })

  it('without a chatId, still injects the shim but no visitor-tracking beacon', () => {
    const built = buildSandpackFiles(
      { '/App.tsx': "export default function App(){ return <div/> }" },
      { origin: 'https://builder.ainative.studio', dbToken: 'real-signed-token' },
    )
    expect(built['/db-token-shim.ts']).toBeDefined()
    expect(built['/db-token-shim.ts']).not.toContain('/api/db/visitors')
  })
})
