// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dbTokenShim } from '@/app/api/preview/[id]/route'

/**
 * dbTokenShim — the inline script injected into every generated app's HTML
 * that patches window.fetch to attach the right auth header per API path.
 *
 * Real bug caught while shipping #496 (ZeroMemory proxy, live-verified
 * end-to-end): the shim rewrote requests to /api/db and /api/primitive/*,
 * but NOT /api/memory/* — meaning even though the route and middleware were
 * both correctly built and live, a real generated app calling ZeroMemory had
 * no way to actually attach the required token. The backend was live-
 * verified with curl, but the CLIENT-SIDE piece that makes a real generated
 * app's fetch() calls actually carry the token was silently missing. This
 * test executes the REAL generated shim script (not a reimplementation) in
 * a real jsdom window, so a future new proxied path added without updating
 * the shim fails a real test instead of silently 401ing in production.
 */

function runShimAndCapture(scriptHtml: string, url: string) {
  const scriptMatch = scriptHtml.match(/<script>([\s\S]*?)<\/script>/)
  const scriptBody = scriptMatch![1]
  const captured: { headers?: Headers } = {}
  const originalFetch = vi.fn(async (_input: any, init?: RequestInit) => {
    captured.headers = new Headers(init?.headers)
    return new Response('{}')
  })
  ;(window as any).fetch = originalFetch
  // eslint-disable-next-line no-new-func
  new Function(scriptBody).call(window)
  return { originalFetch, captured, url }
}

describe('dbTokenShim — generated apps get the right header on the right path', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('attaches x-ainative-db-token on /api/db requests', async () => {
    const html = dbTokenShim('real-db-token')
    const { captured } = runShimAndCapture(html, '/api/db/tasks')
    await window.fetch('/api/db/tasks')
    expect(captured.headers?.get('x-ainative-db-token')).toBe('real-db-token')
  })

  it('attaches x-ainative-db-token on /api/memory/* requests (the real #496 regression)', async () => {
    const html = dbTokenShim('real-db-token')
    const { captured } = runShimAndCapture(html, '/api/memory/remember')
    await window.fetch('/api/memory/remember', { method: 'POST' })
    expect(captured.headers?.get('x-ainative-db-token')).toBe('real-db-token')
  })

  it('attaches x-ainative-db-token on /api/memory/recall too', async () => {
    const html = dbTokenShim('real-db-token')
    const { captured } = runShimAndCapture(html, '/api/memory/recall')
    await window.fetch('/api/memory/recall', { method: 'POST' })
    expect(captured.headers?.get('x-ainative-db-token')).toBe('real-db-token')
  })

  it('attaches x-ainative-primitive-token on a matching /api/primitive/{name}/ path', async () => {
    const html = dbTokenShim('real-db-token', { zerocommerce: 'real-primitive-token' })
    const { captured } = runShimAndCapture(html, '/api/primitive/zerocommerce/products')
    await window.fetch('/api/primitive/zerocommerce/products')
    expect(captured.headers?.get('x-ainative-primitive-token')).toBe('real-primitive-token')
  })

  it('does not attach any token header on an unrelated path', async () => {
    const html = dbTokenShim('real-db-token')
    const { captured } = runShimAndCapture(html, '/api/build/ask')
    await window.fetch('/api/build/ask', { method: 'POST' })
    expect(captured.headers?.get('x-ainative-db-token')).toBeNull()
  })

  it('with no token and no primitive tokens, the shim script is empty (no-op)', () => {
    expect(dbTokenShim('')).toBe('')
  })
})
