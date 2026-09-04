import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mintAppDataToken } from '@/lib/build/app-data-token'

/**
 * /api/opencapstack/[action] (#503) — the OpenCapStack runtime proxy.
 *
 * Real gap closed: primitive-catalog.ts's OpenCapStack entry has REAL
 * checkout-time provisioning (provisionCapTable) but zero runtime call path
 * for a generated app to read its own cap-table record back — same
 * "provisioned but cosmetic" class #443/#496/#500 fixed for other
 * primitives. A SECOND real gap closed alongside this: provisionCapTable's
 * companyId was computed at checkout and silently dropped by
 * setAppProvisioned (accepted the field, had no AppEntry key to land it on)
 * — fixed in app-registry.ts; without that fix this proxy has nothing to
 * look up.
 *
 * AUTH — different shape from ZeroMemory/Agent402/Browser Agent: OpenCapStack
 * has no AINative-federated auth. This route reuses the SAME
 * loginServiceAccount() provisionCapTable already uses in production (logs
 * in fresh per call, short-lived token, not cached) — not a new auth
 * implementation. The signed per-app data token (mintAppDataToken — real,
 * not mocked) gates WHICH generated app is allowed to call this route at
 * all, and resolves which company's opencapstackCompanyId to look up.
 *
 * VERIFICATION NOTE: the GET /companies/{id} upstream shape this route calls
 * was NOT independently curl-verified against the live API before shipping
 * — OPENCAPSTACK_SERVICE_EMAIL/PASSWORD only exist as Railway production
 * vars, not in this dev/test environment. The login + POST /companies write
 * ARE live-proven (every successful provisioning in production exercises
 * them). These tests mock the upstream fetch calls; they prove the ROUTE's
 * own auth/lookup/error-handling logic is correct, not that OpenCapStack's
 * real GET /companies/{id} endpoint returns this exact shape.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(),
  loginServiceAccount: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/opencapstack', () => ({ loginServiceAccount: h.loginServiceAccount }))

function req(action: string, token?: string) {
  return {
    url: `https://builder.ainative.studio/api/opencapstack/${action}`,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null),
    },
    nextUrl: { searchParams: new URLSearchParams() },
  } as any
}

describe('GET /api/opencapstack/[action]', () => {
  const originalFetch = global.fetch
  const realToken = mintAppDataToken('proj-real-123', 'beacon', Math.floor(Date.now() / 1000))

  beforeEach(() => {
    global.fetch = vi.fn()
    h.resolveApp.mockReset()
    h.loginServiceAccount.mockReset()
  })
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('rejects a request with no token at all — fails closed', async () => {
    const { GET } = await import('@/app/api/opencapstack/[action]/route')
    const res = await GET(req('company'), { params: Promise.resolve({ action: 'company' }) })
    expect(res.status).toBe(401)
    expect(h.resolveApp).not.toHaveBeenCalled()
  })

  it('rejects a present-but-forged token — fails closed', async () => {
    const { GET } = await import('@/app/api/opencapstack/[action]/route')
    const res = await GET(req('company', 'forged.token.here'), { params: Promise.resolve({ action: 'company' }) })
    expect(res.status).toBe(401)
    expect(h.resolveApp).not.toHaveBeenCalled()
  })

  it('an unknown action returns 404, never silently no-ops', async () => {
    const { GET } = await import('@/app/api/opencapstack/[action]/route')
    const res = await GET(req('create', realToken), { params: Promise.resolve({ action: 'create' }) })
    expect(res.status).toBe(404)
    expect(h.resolveApp).not.toHaveBeenCalled()
  })

  it('returns 404 when the app has no opencapstackCompanyId provisioned yet', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'beacon', chatId: 'chat-1' })
    const { GET } = await import('@/app/api/opencapstack/[action]/route')
    const res = await GET(req('company', realToken), { params: Promise.resolve({ action: 'company' }) })
    expect(res.status).toBe(404)
    expect(h.loginServiceAccount).not.toHaveBeenCalled()
  })

  it('returns an honest error when the service-account login fails', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'beacon', opencapstackCompanyId: 'ocs-123' })
    h.loginServiceAccount.mockResolvedValue({ ok: false, reason: 'no_service_account' })
    const { GET } = await import('@/app/api/opencapstack/[action]/route')
    const res = await GET(req('company', realToken), { params: Promise.resolve({ action: 'company' }) })
    expect(res.status).toBe(502)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('company: forwards to the real upstream endpoint with the stored companyId once login succeeds', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'beacon', opencapstackCompanyId: 'ocs-123' })
    h.loginServiceAccount.mockResolvedValue({ ok: true, token: 'real-ocs-token' })
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ companyId: 'ocs-123', name: 'Beacon' }) })
    const { GET } = await import('@/app/api/opencapstack/[action]/route')
    const res = await GET(req('company', realToken), { params: Promise.resolve({ action: 'company' }) })
    expect(res.status).toBe(200)
    const [url, init] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/companies/ocs-123')
    expect(init.headers.Authorization).toBe('Bearer real-ocs-token')
  })

  it('propagates a real upstream error status honestly, never masks it as success', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'beacon', opencapstackCompanyId: 'ocs-123' })
    h.loginServiceAccount.mockResolvedValue({ ok: true, token: 'real-ocs-token' })
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 404, json: async () => ({ message: 'not found' }) })
    const { GET } = await import('@/app/api/opencapstack/[action]/route')
    const res = await GET(req('company', realToken), { params: Promise.resolve({ action: 'company' }) })
    expect(res.status).toBe(404)
  })

  it('a different company only ever looks up its OWN stored opencapstackCompanyId', async () => {
    const otherToken = mintAppDataToken('proj-other-456', 'acme', Math.floor(Date.now() / 1000))
    h.resolveApp.mockResolvedValue({ slug: 'acme', opencapstackCompanyId: 'ocs-999' })
    h.loginServiceAccount.mockResolvedValue({ ok: true, token: 'real-ocs-token' })
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ companyId: 'ocs-999' }) })
    const { GET } = await import('@/app/api/opencapstack/[action]/route')
    await GET(req('company', otherToken), { params: Promise.resolve({ action: 'company' }) })
    expect(h.resolveApp).toHaveBeenCalledWith('acme')
    const [url] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain('/companies/ocs-999')
  })
})
