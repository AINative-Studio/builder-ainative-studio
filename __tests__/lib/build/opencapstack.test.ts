import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { provisionCapTable } from '@/lib/build/opencapstack'

/**
 * lib/build/opencapstack — OpenCapStack provisioning client (#427).
 * Two-step flow: service-account login, then POST /companies with the
 * resulting token. Covers: missing service account, login failure, company
 * creation failure, success, JSON parse failure, network error.
 */

function mockFetchSequence(steps: Array<(url: string, init?: RequestInit) => { ok: boolean; status?: number; json?: object | (() => Promise<any>) }>) {
  let call = 0
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const step = steps[Math.min(call, steps.length - 1)]
    call++
    const r = step(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: typeof r.json === 'function' ? r.json : async () => (r.json ?? {}),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.stubEnv('OPENCAPSTACK_SERVICE_EMAIL', 'builder-service@ainative.studio')
  vi.stubEnv('OPENCAPSTACK_SERVICE_PASSWORD', 'a-real-compliant-password-1!')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('provisionCapTable (#427)', () => {
  it('returns { ok: false, reason: "no_service_account" } when credentials are not configured', async () => {
    vi.stubEnv('OPENCAPSTACK_SERVICE_EMAIL', '')
    vi.stubEnv('OPENCAPSTACK_SERVICE_PASSWORD', '')
    const fn = mockFetchSequence([() => ({ ok: true })])
    const result = await provisionCapTable('Acme Corp')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_service_account')
    expect(fn).not.toHaveBeenCalled()
  })

  it('logs in then POSTs to /companies with Bearer auth and the right body shape', async () => {
    const fn = mockFetchSequence([
      () => ({ ok: true, status: 200, json: { accessToken: 'ocs-token-abc' } }),
      () => ({ ok: true, status: 201, json: { companyId: 'COMP-123', CompanyName: 'Acme Corp' } }),
    ])
    const result = await provisionCapTable('Acme Corp')

    expect(result.ok).toBe(true)
    expect(result.companyId).toBe('COMP-123')
    expect(result.status).toBe(201)
    expect(fn).toHaveBeenCalledTimes(2)

    const [loginUrl, loginInit] = fn.mock.calls[0]
    expect(String(loginUrl)).toContain('/auth/login')
    const loginBody = JSON.parse((loginInit as RequestInit).body as string)
    expect(loginBody.email).toBe('builder-service@ainative.studio')
    expect(loginBody.password).toBe('a-real-compliant-password-1!')

    const [companyUrl, companyInit] = fn.mock.calls[1]
    expect(String(companyUrl)).toContain('/companies')
    const companyHeaders = (companyInit as RequestInit).headers as Record<string, string>
    expect(companyHeaders['Authorization']).toBe('Bearer ocs-token-abc')
    const companyBody = JSON.parse((companyInit as RequestInit).body as string)
    expect(companyBody.name).toBe('Acme Corp')
    expect(companyBody.companyType).toBe('Delaware C-Corp')
  })

  it('returns { ok: false } with real reason when login fails (bad credentials)', async () => {
    mockFetchSequence([
      () => ({ ok: false, status: 401, json: { message: 'Invalid credentials' } }),
    ])
    const result = await provisionCapTable('Acme Corp')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
    expect(result.reason).toContain('Invalid credentials')
  })

  it('never attempts company creation when login fails', async () => {
    const fn = mockFetchSequence([
      () => ({ ok: false, status: 401, json: { message: 'Invalid credentials' } }),
    ])
    await provisionCapTable('Acme Corp')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('returns { ok: false } with real reason when company creation fails', async () => {
    mockFetchSequence([
      () => ({ ok: true, status: 200, json: { accessToken: 'tok' } }),
      () => ({ ok: false, status: 400, json: { message: 'Invalid company data' } }),
    ])
    const result = await provisionCapTable('Acme Corp')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.reason).toContain('Invalid company data')
  })

  it('returns { ok: false } (never throws) when fetch throws a network error during login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Connection refused') }))
    const result = await provisionCapTable('Acme Corp')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Connection refused')
  })

  it('returns { ok: false } (never throws) when the login response body is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('Unexpected token') },
    } as unknown as Response)))
    const result = await provisionCapTable('Acme Corp')
    expect(result.ok).toBe(false)
    // json() throws -> data is null -> no accessToken -> falls back to the
    // status code as the reason (matches provisionStore's equivalent case).
    expect(result.status).toBe(200)
  })

  it('returns empty companyId string when the company response has no companyId field', async () => {
    mockFetchSequence([
      () => ({ ok: true, status: 200, json: { accessToken: 'tok' } }),
      () => ({ ok: true, status: 201, json: {} }),
    ])
    const result = await provisionCapTable('Acme Corp')
    expect(result.ok).toBe(true)
    expect(result.companyId).toBe('')
  })

  it('truncates reason to 160 chars for extremely long error messages', async () => {
    const longMessage = 'x'.repeat(300)
    mockFetchSequence([
      () => ({ ok: true, status: 200, json: { accessToken: 'tok' } }),
      () => ({ ok: false, status: 500, json: { message: longMessage } }),
    ])
    const result = await provisionCapTable('Acme Corp')
    expect(result.ok).toBe(false)
    expect((result.reason ?? '').length).toBeLessThanOrEqual(160)
  })
})
