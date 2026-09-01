import { describe, it, expect, vi, afterEach } from 'vitest'
import { provisionZeroERPTenant } from '@/lib/build/zeroerp'

/**
 * lib/build/zeroerp — ZeroERP tenant provisioning client (#439).
 * Covers: the real onboarding/tenants fetch (no auth needed), error
 * shapes, the already_provisioned idempotent case, a malformed success
 * response, no-email guard, and never-throws. All fetch calls are mocked.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; json?: object }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 201 : 500),
      json: async () => (r.json ?? {}),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('provisionZeroERPTenant (#439)', () => {
  it('rejects with no_email when email is missing', async () => {
    const result = await provisionZeroERPTenant('', 'acme', 'Acme Inc')
    expect(result).toEqual({ ok: false, reason: 'no_email' })
  })

  it('provisions a tenant and returns the raw invite token on success', async () => {
    const fn = mockFetch(() => ({
      ok: true,
      status: 201,
      json: {
        data: {
          tenant: { org_id: 'org_acme', org_name: 'Acme Inc', org_slug: 'acme' },
          admin_invite: { invite_token: 'raw-token-123', email: 'founder@acme.test', expires_at: '2026-04-29T15:00:00Z' },
          already_provisioned: false,
        },
      },
    }))
    const result = await provisionZeroERPTenant('founder@acme.test', 'acme', 'Acme Inc')
    expect(result).toEqual({
      ok: true,
      status: 201,
      orgId: 'org_acme',
      orgSlug: 'acme',
      inviteToken: 'raw-token-123',
      inviteExpiresAt: '2026-04-29T15:00:00Z',
      alreadyProvisioned: false,
    })
    const [url, init] = fn.mock.calls[0]
    expect(String(url)).toContain('/onboarding/tenants')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      email: 'founder@acme.test',
      org_name: 'Acme Inc',
      org_slug: 'acme',
    })
    // No auth header — the endpoint is confirmed public.
    expect((init as RequestInit).headers).not.toHaveProperty('Authorization')
  })

  it('handles a response with no "data" wrapper (flat shape)', async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      json: {
        tenant: { org_id: 'org_acme', org_slug: 'acme' },
        admin_invite: { invite_token: 'tok', expires_at: '2026-05-01T00:00:00Z' },
        already_provisioned: true,
      },
    }))
    const result = await provisionZeroERPTenant('founder@acme.test', 'acme', 'Acme Inc')
    expect(result.ok).toBe(true)
    expect(result.alreadyProvisioned).toBe(true)
    expect(result.orgId).toBe('org_acme')
  })

  it('surfaces a real 4xx error honestly', async () => {
    mockFetch(() => ({ ok: false, status: 409, json: { message: 'org_slug already taken by a different email' } }))
    const result = await provisionZeroERPTenant('founder@acme.test', 'acme', 'Acme Inc')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(409)
    expect(result.reason).toContain('org_slug already taken')
  })

  it('falls back to status code string when data has no message/detail', async () => {
    mockFetch(() => ({ ok: false, status: 500, json: {} }))
    const result = await provisionZeroERPTenant('founder@acme.test', 'acme', 'Acme Inc')
    expect(result).toEqual({ ok: false, status: 500, reason: '500' })
  })

  it('never throws when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Connection refused') }))
    const result = await provisionZeroERPTenant('founder@acme.test', 'acme', 'Acme Inc')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Connection refused')
  })

  it('truncates reason to 160 chars for extremely long error messages', async () => {
    const longMessage = 'x'.repeat(300)
    mockFetch(() => ({ ok: false, status: 500, json: { message: longMessage } }))
    const result = await provisionZeroERPTenant('founder@acme.test', 'acme', 'Acme Inc')
    expect((result.reason ?? '').length).toBeLessThanOrEqual(160)
  })

  it('falls back org_name to slug when no company name is given', async () => {
    const fn = mockFetch(() => ({
      ok: true,
      status: 201,
      json: { tenant: { org_id: 'org_x', org_slug: 'acme' }, admin_invite: {}, already_provisioned: false },
    }))
    await provisionZeroERPTenant('founder@acme.test', 'acme', '')
    const [, init] = fn.mock.calls[0]
    expect(JSON.parse(String((init as RequestInit).body)).org_name).toBe('acme')
  })
})
