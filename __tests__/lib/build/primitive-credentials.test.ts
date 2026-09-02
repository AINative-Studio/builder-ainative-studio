import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * primitive-credentials (#443) — durable founder-credential store for
 * primitives scoped to the founder's own AINative identity (ZeroCommerce
 * confirmed via #417's "one store per owner user").
 *
 * All ZeroDB REST calls and the AINative refresh call are mocked; no real
 * network call is made. Encryption itself is exercised for real (reuses
 * credentials.service.ts's AES-256-GCM), so a round-trip proves the actual
 * crypto works, not just that mocks were wired correctly.
 */

// primitive-credentials.ts and credentials.service.ts capture their env vars
// at MODULE LOAD (const), so they must be set BEFORE the import executes.
// ESM hoists `import` above plain top-level statements — vi.hoisted() runs
// above imports (same pattern as __tests__/lib/app-registry-railway.test.ts).
vi.hoisted(() => {
  process.env.ZERODB_PROJECT_ID = 'test-project'
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.DEPLOYMENT_ENCRYPTION_KEY = 'a'.repeat(64) // 32 bytes hex
})

const h = vi.hoisted(() => ({ refreshAINativeToken: vi.fn(), ainativeFetch: vi.fn() }))
vi.mock('@/lib/auth/tokenRefresh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/tokenRefresh')>()
  return { ...actual, refreshAINativeToken: h.refreshAINativeToken }
})
vi.mock('@/lib/ainative/client', () => ({ ainativeFetch: h.ainativeFetch }))

import {
  storeFounderCredential,
  resolveFounderCredential,
  hasFounderCredential,
  fetchOrganizationId,
} from '@/lib/build/primitive-credentials'

function mockFetchSequence(responses: Array<{ ok: boolean; json?: any; text?: string }>) {
  let i = 0
  const fn = vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    return {
      ok: r.ok,
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
      json: async () => r.json ?? {},
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('storeFounderCredential + resolveFounderCredential (#443)', () => {
  it('round-trips a stored access token through real AES-256-GCM encryption', async () => {
    // ensureTable() fires first (idempotent, best-effort), then the real row write.
    const store = mockFetchSequence([{ ok: true }, { ok: true }])
    const ok = await storeFounderCredential('acme', 'zerocommerce', 'real-access-token', 'real-refresh-token', 3600)
    expect(ok).toBe(true)
    expect(store).toHaveBeenCalledTimes(2)

    // Resolve reads the row back — mock the list response with the same
    // encrypted payload storeFounderCredential would have sent (the SECOND
    // call — the first is the ensureTable POST to .../tables, not .../rows).
    const sentBody = JSON.parse(String(((store.mock.calls[1] as any)[1] as any).body))
    mockFetchSequence([{ ok: true, json: { data: [{ row_data: sentBody.row_data }] } }])
    const result = await resolveFounderCredential('acme', 'zerocommerce')
    expect(result.ok).toBe(true)
    expect(result.accessToken).toBe('real-access-token')
  })

  it('creates the table before writing — live-found production bug: the table never existed, so every real store silently failed (returned false, never threw)', async () => {
    // Real production behavior before this fix: POST .../rows 404'd with
    // "Table not found" because no one had ever created the table, and the
    // catch-all swallowed it into a quiet `false`. ensureTable() must fire
    // BEFORE the row write, and the row write's own result is authoritative.
    const store = mockFetchSequence([{ ok: true }, { ok: true }])
    await storeFounderCredential('acme', 'zerocommerce', 'tok', 'refresh', 3600)
    expect(store).toHaveBeenCalledTimes(2)
    const [tableCallUrl] = store.mock.calls[0] as any
    const [rowCallUrl] = store.mock.calls[1] as any
    expect(String(tableCallUrl)).toMatch(/\/database\/tables$/)
    expect(String(rowCallUrl)).toMatch(/\/database\/tables\/builder_primitive_credentials\/rows$/)
    const tableCallBody = JSON.parse(String(((store.mock.calls[0] as any)[1] as any).body))
    expect(tableCallBody).toEqual({ table_name: 'builder_primitive_credentials' })
  })

  it('still returns false if the real row write fails, even when ensureTable succeeds — table-create success never masks a real write failure', async () => {
    const store = mockFetchSequence([{ ok: true }, { ok: false }])
    const ok = await storeFounderCredential('acme', 'zerocommerce', 'tok', 'refresh', 3600)
    expect(ok).toBe(false)
    expect(store).toHaveBeenCalledTimes(2)
  })

  it('never throws even when ensureTable itself throws (e.g. network error on the create call) — falls through to the real write attempt', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++
      if (call === 1) throw new Error('ensureTable network error')
      return { ok: true, text: async () => '{}', json: async () => ({}) } as unknown as Response
    }))
    const ok = await storeFounderCredential('acme', 'zerocommerce', 'tok', 'refresh', 3600)
    expect(ok).toBe(true)
  })

  it('returns not_provisioned when no credential was ever stored', async () => {
    mockFetchSequence([{ ok: true, json: { data: [] } }])
    const result = await resolveFounderCredential('never-provisioned', 'zerocommerce')
    expect(result).toEqual({ ok: false, reason: 'not_provisioned' })
  })

  it('never throws on a network failure — fails closed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await resolveFounderCredential('acme', 'zerocommerce')
    expect(result.ok).toBe(false)
  })

  it('auto-refreshes a near-expiry token and persists the rotated pair', async () => {
    const store1 = mockFetchSequence([{ ok: true }, { ok: true }])
    await storeFounderCredential('acme', 'zerocommerce', 'old-access', 'old-refresh', -10) // already expired
    const sentBody = JSON.parse(String(((store1.mock.calls[1] as any)[1] as any).body))

    h.refreshAINativeToken.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresIn: 3600,
    })

    const listThenStore = mockFetchSequence([
      { ok: true, json: { data: [{ row_data: sentBody.row_data }] } }, // resolve reads the expired row
      { ok: true }, // ensureTable, ahead of the re-store
      { ok: true }, // the re-store of the refreshed pair
    ])

    const result = await resolveFounderCredential('acme', 'zerocommerce')
    expect(h.refreshAINativeToken).toHaveBeenCalledWith('old-refresh')
    expect(result.ok).toBe(true)
    expect(result.accessToken).toBe('new-access')
    expect(listThenStore).toHaveBeenCalledTimes(3)
  })

  it('fails closed (refresh_failed) when the stored refresh token is invalid/revoked', async () => {
    const store1 = mockFetchSequence([{ ok: true }, { ok: true }])
    await storeFounderCredential('acme', 'zerocommerce', 'old-access', 'old-refresh', -10)
    const sentBody = JSON.parse(String(((store1.mock.calls[1] as any)[1] as any).body))

    h.refreshAINativeToken.mockResolvedValue(null) // revoked/invalid refresh token

    mockFetchSequence([{ ok: true, json: { data: [{ row_data: sentBody.row_data }] } }])

    const result = await resolveFounderCredential('acme', 'zerocommerce')
    expect(result).toEqual({ ok: false, reason: 'refresh_failed' })
  })

  it('never leaks the raw token in storeFounderCredential\'s persisted row', async () => {
    const store = mockFetchSequence([{ ok: true }, { ok: true }])
    await storeFounderCredential('acme', 'zerocommerce', 'super-secret-token', 'super-secret-refresh', 3600)
    const sentBody = JSON.parse(String(((store.mock.calls[1] as any)[1] as any).body))
    const serialized = JSON.stringify(sentBody)
    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).not.toContain('super-secret-refresh')
  })
})

describe('organizationId (#414 — ZeroCRM support)', () => {
  it('round-trips organizationId through store + resolve', async () => {
    const store = mockFetchSequence([{ ok: true }, { ok: true }])
    await storeFounderCredential('acme', 'zerocrm', 'crm-token', undefined, 3600, 'real-org-uuid')
    const sentBody = JSON.parse(String(((store.mock.calls[1] as any)[1] as any).body))
    expect(sentBody.row_data.organizationId).toBe('real-org-uuid')

    mockFetchSequence([{ ok: true, json: { data: [{ row_data: sentBody.row_data }] } }])
    const result = await resolveFounderCredential('acme', 'zerocrm')
    expect(result.ok).toBe(true)
    expect(result.organizationId).toBe('real-org-uuid')
  })

  it('is undefined for the other 4 primitives, which never pass one', async () => {
    const store = mockFetchSequence([{ ok: true }, { ok: true }])
    await storeFounderCredential('acme', 'zerocommerce', 'tok', undefined, 3600)
    const sentBody = JSON.parse(String(((store.mock.calls[1] as any)[1] as any).body))
    expect(sentBody.row_data.organizationId).toBeUndefined()

    mockFetchSequence([{ ok: true, json: { data: [{ row_data: sentBody.row_data }] } }])
    const result = await resolveFounderCredential('acme', 'zerocommerce')
    expect(result.organizationId).toBeUndefined()
  })

  it('is preserved across a token refresh', async () => {
    const store1 = mockFetchSequence([{ ok: true }, { ok: true }])
    await storeFounderCredential('acme', 'zerocrm', 'old-access', 'old-refresh', -10, 'org-abc')
    const sentBody = JSON.parse(String(((store1.mock.calls[1] as any)[1] as any).body))

    h.refreshAINativeToken.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600 })

    const listThenStore = mockFetchSequence([
      { ok: true, json: { data: [{ row_data: sentBody.row_data }] } },
      { ok: true },
      { ok: true },
    ])

    const result = await resolveFounderCredential('acme', 'zerocrm')
    expect(result.organizationId).toBe('org-abc')
    // The re-store after refresh must also carry organizationId forward, not drop it.
    const reStoreBody = JSON.parse(String(((listThenStore.mock.calls[2] as any)[1] as any).body))
    expect(reStoreBody.row_data.organizationId).toBe('org-abc')
  })
})

describe('fetchOrganizationId (#414)', () => {
  beforeEach(() => h.ainativeFetch.mockReset())

  it('returns the real organization_uuid from /api/v1/auth/me', async () => {
    h.ainativeFetch.mockResolvedValue({ organization_uuid: 'real-org-uuid' })
    const id = await fetchOrganizationId('some-jwt')
    expect(id).toBe('real-org-uuid')
    expect(h.ainativeFetch).toHaveBeenCalledWith('/api/v1/auth/me', 'some-jwt', { method: 'GET' })
  })

  it('returns undefined when the response has no organization_uuid', async () => {
    h.ainativeFetch.mockResolvedValue({ email: 'a@b.com' })
    expect(await fetchOrganizationId('jwt')).toBeUndefined()
  })

  it('returns undefined, never throws, when ainativeFetch fails (e.g. a real 401)', async () => {
    h.ainativeFetch.mockReset()
    h.ainativeFetch.mockImplementationOnce(() => Promise.reject(new Error('Unauthorized')))
    await expect(fetchOrganizationId('jwt')).resolves.toBeUndefined()
  })
})

describe('hasFounderCredential (#443)', () => {
  it('returns true when a credential row exists', async () => {
    mockFetchSequence([{ ok: true, json: { data: [{ row_data: { slug: 'acme', primitive: 'zerocommerce', encryptedToken: 'x', iv: 'y', authTag: 'z', createdAt: '2026-01-01' } }] } }])
    expect(await hasFounderCredential('acme', 'zerocommerce')).toBe(true)
  })

  it('returns false when none exists', async () => {
    mockFetchSequence([{ ok: true, json: { data: [] } }])
    expect(await hasFounderCredential('acme', 'zerocommerce')).toBe(false)
  })
})
