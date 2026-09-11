// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dbTokenShim, FOUNDER_SCOPED_PRIMITIVES } from '@/app/api/preview/[id]/route'
import type { FounderScopedPrimitive } from '@/lib/build/primitive-credentials'

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

  it('attaches x-ainative-db-token on /api/browser-agent/* requests (#499)', async () => {
    const html = dbTokenShim('real-db-token')
    const { captured } = runShimAndCapture(html, '/api/browser-agent/extract')
    await window.fetch('/api/browser-agent/extract', { method: 'POST' })
    expect(captured.headers?.get('x-ainative-db-token')).toBe('real-db-token')
  })

  it('attaches x-ainative-db-token on /api/browser-agent/act too', async () => {
    const html = dbTokenShim('real-db-token')
    const { captured } = runShimAndCapture(html, '/api/browser-agent/act')
    await window.fetch('/api/browser-agent/act', { method: 'POST' })
    expect(captured.headers?.get('x-ainative-db-token')).toBe('real-db-token')
  })

  it('attaches x-ainative-db-token on /api/agent402/* requests (#500)', async () => {
    const html = dbTokenShim('real-db-token')
    const { captured } = runShimAndCapture(html, '/api/agent402/capabilities')
    await window.fetch('/api/agent402/capabilities')
    expect(captured.headers?.get('x-ainative-db-token')).toBe('real-db-token')
  })

  it('attaches x-ainative-db-token on /api/agent402/projects too', async () => {
    const html = dbTokenShim('real-db-token')
    const { captured } = runShimAndCapture(html, '/api/agent402/projects')
    await window.fetch('/api/agent402/projects')
    expect(captured.headers?.get('x-ainative-db-token')).toBe('real-db-token')
  })

  it('attaches x-ainative-db-token on /api/opencapstack/* requests (#503)', async () => {
    const html = dbTokenShim('real-db-token')
    const { captured } = runShimAndCapture(html, '/api/opencapstack/company')
    await window.fetch('/api/opencapstack/company')
    expect(captured.headers?.get('x-ainative-db-token')).toBe('real-db-token')
  })

  it('attaches x-ainative-db-token on /api/model-catalog/* requests (#505)', async () => {
    const html = dbTokenShim('real-db-token')
    const { captured } = runShimAndCapture(html, '/api/model-catalog/list')
    await window.fetch('/api/model-catalog/list')
    expect(captured.headers?.get('x-ainative-db-token')).toBe('real-db-token')
  })

  it('attaches x-ainative-db-token on /api/ainative-ngo/* requests', async () => {
    const html = dbTokenShim('real-db-token')
    const { captured } = runShimAndCapture(html, '/api/ainative-ngo/institutions')
    await window.fetch('/api/ainative-ngo/institutions')
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

/**
 * Real bug found live (Dispatch, 2026-09-11): FOUNDER_SCOPED_PRIMITIVES
 * (the list of primitives the preview route mints a proxy token for) only
 * ever had the original 4 entries (#443) — every founder-scoped primitive
 * added since (zerocrm #414/#655, zerovoice #522, zeroinvoice #638/#639,
 * serviceos #642, livestreaming/socialgraph #644) was silently missing, so
 * a real generated app calling e.g. ServiceOS from inside the shared
 * preview iframe got a 401 even for a company with a genuinely captured
 * ServiceOS credential — confirmed live: Dispatch's own
 * /api/primitive/zeropipeline/deals call 401'd from inside the preview
 * iframe. This test fails automatically the next time a founder-scoped
 * primitive is added to FounderScopedPrimitive but not to this list, so
 * the same silent-401 class of bug can't recur unnoticed.
 */
describe('FOUNDER_SCOPED_PRIMITIVES stays in sync with FounderScopedPrimitive', () => {
  it('includes every current founder-scoped primitive (confirmed live-callable via /api/primitive/{name}/...)', () => {
    // Kept in sync manually with lib/build/primitive-credentials.ts's
    // FounderScopedPrimitive union — contentworkflow is the one deliberate
    // exception (it uses Builder's own service key, not a founder
    // credential, so it needs no preview-iframe proxy token at all).
    const expected: FounderScopedPrimitive[] = [
      'zerocommerce', 'zeropipeline', 'agentflow', 'zeroforms', 'zerocrm',
      'zerovoice', 'zeroinvoice', 'serviceos', 'livestreaming', 'socialgraph',
    ]
    expect([...FOUNDER_SCOPED_PRIMITIVES].sort()).toEqual([...expected].sort())
  })

  it('mints a real primitive-proxy token shim for a primitive added after the original 4 (e.g. serviceos)', async () => {
    expect(FOUNDER_SCOPED_PRIMITIVES).toContain('serviceos')
    const html = dbTokenShim('real-db-token', { serviceos: 'real-serviceos-token' })
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/)
    const scriptBody = scriptMatch![1]
    const captured: { headers?: Headers } = {}
    ;(window as any).fetch = vi.fn(async (_input: any, init?: RequestInit) => {
      captured.headers = new Headers(init?.headers)
      return new Response('{}')
    })
    // eslint-disable-next-line no-new-func
    new Function(scriptBody).call(window)
    await window.fetch('/api/primitive/serviceos/tickets')
    expect(captured.headers?.get('x-ainative-primitive-token')).toBe('real-serviceos-token')
  })
})
