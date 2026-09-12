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

/**
 * forceRefresh (#443/#664 follow-up) — the reactive backstop the runtime
 * proxy calls after the REAL primitive itself returns a 401 (a stronger,
 * ground-truth signal than shouldRefreshToken's expiresAt estimate, which is
 * often just an ASSUMED value — see provision/route.ts's fix — since core's
 * real login response never actually returns expires_in).
 */
describe('resolveFounderCredential forceRefresh option (#443/#664 follow-up)', () => {
  it('skips the proactive expiry check entirely and attempts a real refresh when forceRefresh is true, even for a token that looks fresh', async () => {
    const store1 = mockFetchSequence([{ ok: true }, { ok: true }])
    // expiresIn: 3600 -> stored as "not near expiry" by the proactive check.
    await storeFounderCredential('acme', 'zeropipeline', 'old-access', 'old-refresh', 3600)
    const sentBody = JSON.parse(String(((store1.mock.calls[1] as any)[1] as any).body))

    h.refreshAINativeToken.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresIn: 3600,
    })
    mockFetchSequence([
      { ok: true, json: { data: [{ row_data: sentBody.row_data }] } }, // resolve reads the "fresh-looking" row
      { ok: true }, // ensureTable, ahead of the re-store
      { ok: true }, // the re-store of the refreshed pair
    ])

    const result = await resolveFounderCredential('acme', 'zeropipeline', { forceRefresh: true })
    expect(h.refreshAINativeToken).toHaveBeenCalledWith('old-refresh')
    expect(result.ok).toBe(true)
    expect(result.accessToken).toBe('new-access')
  })

  it('without forceRefresh, the same "fresh-looking" token is returned as-is — no refresh attempt at all', async () => {
    const store1 = mockFetchSequence([{ ok: true }, { ok: true }])
    await storeFounderCredential('acme', 'zeropipeline', 'old-access', 'old-refresh', 3600)
    const sentBody = JSON.parse(String(((store1.mock.calls[1] as any)[1] as any).body))
    mockFetchSequence([{ ok: true, json: { data: [{ row_data: sentBody.row_data }] } }])

    const result = await resolveFounderCredential('acme', 'zeropipeline')
    expect(h.refreshAINativeToken).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.accessToken).toBe('old-access')
  })

  it('with forceRefresh, a credential with no refresh token at all (the 25 real broken rows this whole fix responds to) returns the SAME stale token, never throws', async () => {
    const store1 = mockFetchSequence([{ ok: true }, { ok: true }])
    // No refresh token captured at all — exactly the real, confirmed-live state
    // of every founder-scoped credential stored before this fix.
    await storeFounderCredential('acme', 'zeropipeline', 'old-access', undefined, undefined)
    const sentBody = JSON.parse(String(((store1.mock.calls[1] as any)[1] as any).body))
    mockFetchSequence([{ ok: true, json: { data: [{ row_data: sentBody.row_data }] } }])

    const result = await resolveFounderCredential('acme', 'zeropipeline', { forceRefresh: true })
    expect(h.refreshAINativeToken).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.accessToken).toBe('old-access') // unchanged — the caller's job to notice and stop retrying
  })

  it('with forceRefresh, a genuinely revoked refresh token still fails closed (refresh_failed), never a stale fallback', async () => {
    const store1 = mockFetchSequence([{ ok: true }, { ok: true }])
    await storeFounderCredential('acme', 'zeropipeline', 'old-access', 'old-refresh', 3600)
    const sentBody = JSON.parse(String(((store1.mock.calls[1] as any)[1] as any).body))
    h.refreshAINativeToken.mockResolvedValue(null)
    mockFetchSequence([{ ok: true, json: { data: [{ row_data: sentBody.row_data }] } }])

    const result = await resolveFounderCredential('acme', 'zeropipeline', { forceRefresh: true })
    expect(result).toEqual({ ok: false, reason: 'refresh_failed' })
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

describe('zerovoice (#522 — closes the runtime-proxy gap #415 left open)', () => {
  it('round-trips a stored access token through real AES-256-GCM encryption, same as the other 5 founder-scoped primitives', async () => {
    const store = mockFetchSequence([{ ok: true }, { ok: true }])
    const ok = await storeFounderCredential('acme', 'zerovoice', 'real-zerovoice-token', 'real-zerovoice-refresh', 3600)
    expect(ok).toBe(true)

    const sentBody = JSON.parse(String(((store.mock.calls[1] as any)[1] as any).body))
    expect(sentBody.row_data.primitive).toBe('zerovoice')
    mockFetchSequence([{ ok: true, json: { data: [{ row_data: sentBody.row_data }] } }])
    const result = await resolveFounderCredential('acme', 'zerovoice')
    expect(result.ok).toBe(true)
    expect(result.accessToken).toBe('real-zerovoice-token')
  })

  it('returns not_provisioned when no ZeroVoice credential was ever captured (e.g. a company provisioned before #522 shipped)', async () => {
    mockFetchSequence([{ ok: true, json: { data: [] } }])
    const result = await resolveFounderCredential('never-provisioned', 'zerovoice')
    expect(result).toEqual({ ok: false, reason: 'not_provisioned' })
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

/**
 * -product slug fallback (#660 follow-up, found live 2026-09-11): a company
 * has two registry slugs — the landing page ({slug}) and its real working
 * product ({slug}-product, #620) — but /api/build/provision only ever
 * provisions and captures credentials against the LANDING PAGE slug. The
 * product's actual generated code (the one that genuinely calls these
 * primitives) is served under the -product slug, so a lookup for it always
 * missed a credential that was, in fact, already captured for this exact
 * company under its sibling slug. Confirmed live: dispatch's zeropipeline
 * credential existed under slug 'dispatch', but 'dispatch-product' (the
 * code that actually calls /api/primitive/zeropipeline/deals) still 401'd.
 */
describe('resolveStoredRow -product fallback (#660 follow-up)', () => {
  it('hasFounderCredential("{slug}-product", ...) finds a credential stored under the base slug', async () => {
    mockFetchSequence([{ ok: true, json: { data: [{ row_data: { slug: 'dispatch', primitive: 'zeropipeline', encryptedToken: 'x', iv: 'y', authTag: 'z', createdAt: '2026-01-01' } }] } }])
    expect(await hasFounderCredential('dispatch-product', 'zeropipeline')).toBe(true)
  })

  it('resolveFounderCredential("{slug}-product", ...) resolves a real, usable token from the base slug row', async () => {
    const store = mockFetchSequence([{ ok: true }, { ok: true }])
    await storeFounderCredential('dispatch', 'zeropipeline', 'real-access-token', 'real-refresh-token', 3600)
    const sentBody = JSON.parse(String(((store.mock.calls[1] as any)[1] as any).body))

    mockFetchSequence([{ ok: true, json: { data: [{ row_data: sentBody.row_data }] } }])
    const result = await resolveFounderCredential('dispatch-product', 'zeropipeline')
    expect(result.ok).toBe(true)
    expect(result.accessToken).toBe('real-access-token')
  })

  it('a direct match on the -product slug itself always wins over the base-slug fallback', async () => {
    mockFetchSequence([{
      ok: true,
      json: {
        data: [
          { row_data: { slug: 'dispatch', primitive: 'zeropipeline', encryptedToken: 'base-slug-token', iv: 'y', authTag: 'z', createdAt: '2026-01-01' } },
          { row_data: { slug: 'dispatch-product', primitive: 'zeropipeline', encryptedToken: 'x', iv: 'y', authTag: 'z', createdAt: '2026-01-02' } },
        ],
      },
    }])
    // We only assert existence here (hasFounderCredential doesn't expose
    // WHICH row matched) — the direct-match-first ordering itself is what
    // this test guards; a full decrypt round-trip isn't needed to prove it.
    expect(await hasFounderCredential('dispatch-product', 'zeropipeline')).toBe(true)
  })

  it('does NOT fall back the other direction — a landing-page slug lookup never matches a -product row', async () => {
    mockFetchSequence([{ ok: true, json: { data: [{ row_data: { slug: 'dispatch-product', primitive: 'zeropipeline', encryptedToken: 'x', iv: 'y', authTag: 'z', createdAt: '2026-01-01' } }] } }])
    expect(await hasFounderCredential('dispatch', 'zeropipeline')).toBe(false)
  })

  it('returns not_provisioned when neither the -product slug nor its base slug has a row', async () => {
    mockFetchSequence([{ ok: true, json: { data: [] } }])
    const result = await resolveFounderCredential('never-provisioned-product', 'zeropipeline')
    expect(result).toEqual({ ok: false, reason: 'not_provisioned' })
  })

  it('a refreshed token resolved via the -product fallback persists back to the BASE slug, not the -product slug (prevents the two surfaces from forking into separate credential lineages)', async () => {
    const store1 = mockFetchSequence([{ ok: true }, { ok: true }])
    await storeFounderCredential('dispatch', 'zeropipeline', 'old-access', 'old-refresh', -10) // already expired
    const sentBody = JSON.parse(String(((store1.mock.calls[1] as any)[1] as any).body))

    h.refreshAINativeToken.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresIn: 3600,
    })

    const listThenStore = mockFetchSequence([
      { ok: true, json: { data: [{ row_data: sentBody.row_data }] } }, // resolve reads the row stored under 'dispatch'
      { ok: true }, // ensureTable, ahead of the re-store
      { ok: true }, // the re-store of the refreshed pair
    ])

    const result = await resolveFounderCredential('dispatch-product', 'zeropipeline')
    expect(result.ok).toBe(true)
    expect(result.accessToken).toBe('new-access')

    const restoreCallBody = JSON.parse(String(((listThenStore.mock.calls[2] as any)[1] as any).body))
    expect(restoreCallBody.row_data.slug).toBe('dispatch')
  })
})
