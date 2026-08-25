import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they
// must be set BEFORE the import executes. vi.hoisted() runs above imports.
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import {
  registerApp,
  resolveApp,
  setAppDomain,
  setAppOwner,
  setAppPlan,
  setAppProvisioned,
  setAppLifecycle,
  listAppsForOwner,
  claimCompanyProject,
} from '@/lib/build/app-registry'

// --------------- helpers ---------------

function rowsResponse(rows: any[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}

function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
}

function failResponse(status = 500): Response {
  return { ok: false, status, json: async () => ({}), text: async () => '' } as unknown as Response
}

function row(slug: string, extra: Record<string, unknown> = {}): any {
  return { slug, chatId: `chat-${slug}`, createdAt: '2026-08-01T00:00:00Z', ...extra }
}

// =======================================
// registerApp
// =======================================
describe('registerApp', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns false when slug is missing', async () => {
    const ok = await registerApp({ slug: '', chatId: 'c1' })
    expect(ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns false when chatId is missing', async () => {
    const ok = await registerApp({ slug: 'acme', chatId: '' })
    expect(ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('POSTs a row with createdAt when slug + chatId are present', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await registerApp({ slug: 'acme', chatId: 'c1', name: 'Acme Corp' })
    expect(ok).toBe(true)
    const call = fetchMock.mock.calls[0]
    expect(call[1].method).toBe('POST')
    const body = JSON.parse(call[1].body)
    expect(body.row_data.slug).toBe('acme')
    expect(body.row_data.chatId).toBe('c1')
    expect(body.row_data.createdAt).toBeTruthy()
    expect(body.row_data.name).toBe('Acme Corp')
  })

  it('returns false when the POST response is not ok', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(failResponse())
    const ok = await registerApp({ slug: 'acme', chatId: 'c1' })
    expect(ok).toBe(false)
  })

  it('returns false without throwing when fetch rejects', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error('network error'))
    const ok = await registerApp({ slug: 'acme', chatId: 'c1' })
    expect(ok).toBe(false)
  })
})

// =======================================
// resolveApp
// =======================================
describe('resolveApp', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns null when slug is empty (no fetch)', async () => {
    const result = await resolveApp('')
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns null when the fetch response is not ok', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(failResponse())
    const result = await resolveApp('acme')
    expect(result).toBeNull()
  })

  it('returns null when no rows match the slug', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('other')]))
    const result = await resolveApp('acme')
    expect(result).toBeNull()
  })

  it('returns the most recent row (latest-wins) when multiple rows exist', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([
        { slug: 'acme', chatId: 'chat-old', createdAt: '2026-07-01T00:00:00Z' },
        { slug: 'acme', chatId: 'chat-new', createdAt: '2026-08-10T00:00:00Z' },
      ]),
    )
    const result = await resolveApp('acme')
    expect(result?.chatId).toBe('chat-new')
  })

  it('treats lifecycleStatus=deleted as gone (returns null)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme', { lifecycleStatus: 'deleted' })]))
    const result = await resolveApp('acme')
    expect(result).toBeNull()
  })

  it('returns the entry when lifecycleStatus is "offline" (only deleted is hidden)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme', { lifecycleStatus: 'offline' })]))
    const result = await resolveApp('acme')
    expect(result?.lifecycleStatus).toBe('offline')
  })

  it('returns null without throwing when fetch rejects', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error('timeout'))
    const result = await resolveApp('acme')
    expect(result).toBeNull()
  })

  it('handles a top-level array response shape (no .data wrapper)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ row_data: row('acme') }]),
    } as unknown as Response)
    const result = await resolveApp('acme')
    expect(result?.slug).toBe('acme')
  })

  it('handles a .rows wrapper instead of .data', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ rows: [{ row_data: row('acme') }] }),
    } as unknown as Response)
    const result = await resolveApp('acme')
    expect(result?.slug).toBe('acme')
  })
})

// =======================================
// setAppDomain
// =======================================
describe('setAppDomain', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns false when slug is not registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const ok = await setAppDomain('ghost', 'acme.com')
    expect(ok).toBe(false)
  })

  it('writes the domain and preserves existing fields', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme', { plan: 'pro' })]))
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppDomain('acme', 'acme.com')
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.domain).toBe('acme.com')
    expect(body.row_data.plan).toBe('pro')
    expect(body.row_data.slug).toBe('acme')
  })
})

// =======================================
// setAppOwner
// =======================================
describe('setAppOwner', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns false (no fetch) when email is empty', async () => {
    const ok = await setAppOwner('acme', '')
    expect(ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns false when slug is not registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const ok = await setAppOwner('ghost', 'founder@acme.com')
    expect(ok).toBe(false)
  })

  it('is idempotent — no POST when the same email is already set', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme', { ownerEmail: 'founder@acme.com' })]))
    const ok = await setAppOwner('acme', 'Founder@Acme.com')
    expect(ok).toBe(true)
    const posts = fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'POST')
    expect(posts.length).toBe(0)
  })

  it('writes a row with the lowercased, trimmed owner email', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')]))
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppOwner('acme', '  FOUNDER@ACME.COM  ')
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.ownerEmail).toBe('founder@acme.com')
  })
})

// =======================================
// setAppPlan
// =======================================
describe('setAppPlan', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns false when slug is not registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const ok = await setAppPlan('ghost', 'pro')
    expect(ok).toBe(false)
  })

  it('writes the plan with enrolled=false for the "pro" tier', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')]))
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppPlan('acme', 'pro')
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.plan).toBe('pro')
    expect(body.row_data.enrolled).toBe(false)
  })

  it('sets enrolled=true for the "business" plan (auto-enroll into nightly loop)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')]))
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppPlan('acme', 'business')
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.enrolled).toBe(true)
  })

  it('sets enrolled=true for the "enterprise" plan', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')]))
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppPlan('acme', 'enterprise')
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.enrolled).toBe(true)
  })

  it('sets enrolled=true for the "cody_vcto" plan', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')]))
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppPlan('acme', 'cody_vcto')
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.enrolled).toBe(true)
  })
})

// =======================================
// setAppProvisioned
// =======================================
describe('setAppProvisioned', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns false when slug is not registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const ok = await setAppProvisioned('ghost', { zerodbProjectId: 'proj-1', keyKind: 'tmp' })
    expect(ok).toBe(false)
  })

  it('writes provisioning fields and auto-generates provisionedAt', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')]))
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppProvisioned('acme', {
      zerodbProjectId: 'proj-1',
      keyKind: 'tmp',
      claimToken: 'tok-abc',
      deployUrl: 'https://preview.ainative.studio/acme',
    })
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.zerodbProjectId).toBe('proj-1')
    expect(body.row_data.keyKind).toBe('tmp')
    expect(body.row_data.claimToken).toBe('tok-abc')
    expect(body.row_data.provisionedAt).toBeTruthy()
  })

  it('uses the caller-supplied provisionedAt when provided (no override)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')]))
    fetchMock.mockResolvedValueOnce(okResponse())
    const customAt = '2026-01-01T00:00:00.000Z'
    await setAppProvisioned('acme', { zerodbProjectId: 'proj-1', provisionedAt: customAt })
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.provisionedAt).toBe(customAt)
  })

  it('writes railwayServiceId + workspaceId when included', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')]))
    fetchMock.mockResolvedValueOnce(okResponse())
    await setAppProvisioned('acme', {
      railwayServiceId: 'svc-xyz',
      workspaceId: 'ws-1',
      workspaceFiled: true,
    })
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.railwayServiceId).toBe('svc-xyz')
    expect(body.row_data.workspaceId).toBe('ws-1')
    expect(body.row_data.workspaceFiled).toBe(true)
  })
})

// =======================================
// setAppLifecycle
// =======================================
describe('setAppLifecycle', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns false when slug is not registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const ok = await setAppLifecycle('ghost', 'offline')
    expect(ok).toBe(false)
  })

  it('is idempotent — no POST when status is already the same', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme', { lifecycleStatus: 'offline' })]))
    const ok = await setAppLifecycle('acme', 'offline')
    expect(ok).toBe(true)
    const posts = fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'POST')
    expect(posts.length).toBe(0)
  })

  it('treats absent lifecycleStatus as "active" for idempotency — no POST when setting "active"', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')]))
    const ok = await setAppLifecycle('acme', 'active')
    expect(ok).toBe(true)
    const posts = fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'POST')
    expect(posts.length).toBe(0)
  })

  it('writes a new row with the status and a lifecycleAt timestamp when status changes', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme', { lifecycleStatus: 'active' })]))
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppLifecycle('acme', 'offline')
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.lifecycleStatus).toBe('offline')
    expect(body.row_data.lifecycleAt).toBeTruthy()
  })

  it('soft-delete with "deleted" preserves all other fields', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme', { plan: 'pro', zerodbProjectId: 'proj-1' })]))
    fetchMock.mockResolvedValueOnce(okResponse())
    await setAppLifecycle('acme', 'deleted')
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.lifecycleStatus).toBe('deleted')
    expect(body.row_data.plan).toBe('pro')
    expect(body.row_data.zerodbProjectId).toBe('proj-1')
  })
})

// =======================================
// listAppsForOwner
// =======================================
describe('listAppsForOwner', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns empty array when no email is provided (no fetch)', async () => {
    const result = await listAppsForOwner('')
    expect(result).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns empty array on a non-ok response', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(failResponse())
    const result = await listAppsForOwner('founder@acme.com')
    expect(result).toEqual([])
  })

  it('returns empty array without throwing when fetch rejects', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error('timeout'))
    const result = await listAppsForOwner('founder@acme.com')
    expect(result).toEqual([])
  })

  it('returns only apps owned by the given email (case-insensitive match)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([
        row('acme', { ownerEmail: 'founder@acme.com' }),
        row('rival', { ownerEmail: 'someone@rival.com' }),
        row('mine2', { ownerEmail: 'FOUNDER@ACME.COM' }),
      ]),
    )
    const result = await listAppsForOwner('founder@acme.com')
    expect(result.map((e) => e.slug).sort()).toEqual(['acme', 'mine2'])
  })

  it('deduplicates using latest-wins per slug (mirrors resolveApp)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([
        { slug: 'acme', chatId: 'chat-old', ownerEmail: 'founder@acme.com', createdAt: '2026-07-01T00:00:00Z' },
        { slug: 'acme', chatId: 'chat-new', ownerEmail: 'founder@acme.com', createdAt: '2026-08-10T00:00:00Z' },
      ]),
    )
    const result = await listAppsForOwner('founder@acme.com')
    expect(result.length).toBe(1)
    expect(result[0].chatId).toBe('chat-new')
  })

  it('sorts results most-recently-created first', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([
        row('old-app', { ownerEmail: 'founder@acme.com', createdAt: '2026-01-01T00:00:00Z' }),
        row('new-app', { ownerEmail: 'founder@acme.com', createdAt: '2026-08-20T00:00:00Z' }),
        row('mid-app', { ownerEmail: 'founder@acme.com', createdAt: '2026-05-01T00:00:00Z' }),
      ]),
    )
    const result = await listAppsForOwner('founder@acme.com')
    expect(result.map((e) => e.slug)).toEqual(['new-app', 'mid-app', 'old-app'])
  })

  it('skips rows with missing slug or chatId', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([
        row('acme', { ownerEmail: 'founder@acme.com' }),
        { ownerEmail: 'founder@acme.com', createdAt: '2026-08-01T00:00:00Z' }, // no slug/chatId
      ]),
    )
    const result = await listAppsForOwner('founder@acme.com')
    expect(result.length).toBe(1)
    expect(result[0].slug).toBe('acme')
  })

  it('handles a top-level array response shape (no .data wrapper)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ row_data: row('acme', { ownerEmail: 'founder@acme.com' }) }]),
    } as unknown as Response)
    const result = await listAppsForOwner('founder@acme.com')
    expect(result.length).toBe(1)
    expect(result[0].slug).toBe('acme')
  })
})

// =======================================
// claimCompanyProject
// =======================================
describe('claimCompanyProject', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns not_registered when the slug has no entry', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const res = await claimCompanyProject('ghost', 'jwt-token')
    expect(res).toEqual({ ok: false, claimed: false, reason: 'not_registered' })
  })

  it('returns not_tmp when there is no zerodbProjectId (never provisioned)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')]))
    const res = await claimCompanyProject('acme', 'jwt-token')
    expect(res.ok).toBe(true)
    expect(res.claimed).toBe(false)
    expect(res.reason).toBe('not_tmp')
  })

  it('returns already_permanent when keyKind is "permanent"', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([row('acme', { zerodbProjectId: 'proj-1', keyKind: 'permanent' })]),
    )
    const res = await claimCompanyProject('acme', 'jwt-token')
    expect(res.ok).toBe(true)
    expect(res.claimed).toBe(false)
    expect(res.reason).toBe('already_permanent')
  })

  it('returns no_claim_token when keyKind=tmp but claimToken is absent', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([row('acme', { zerodbProjectId: 'proj-1', keyKind: 'tmp' })]),
    )
    const res = await claimCompanyProject('acme', 'jwt-token')
    expect(res).toEqual({ ok: false, claimed: false, reason: 'no_claim_token' })
  })

  it('returns no_jwt when jwt is empty', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([row('acme', { zerodbProjectId: 'proj-1', keyKind: 'tmp', claimToken: 'tok-1' })]),
    )
    const res = await claimCompanyProject('acme', '')
    expect(res).toEqual({ ok: false, claimed: false, reason: 'no_jwt' })
  })

  it('successfully claims and flips keyKind to permanent on HTTP 200', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    // 1: resolveApp GET
    fetchMock.mockResolvedValueOnce(
      rowsResponse([row('acme', { zerodbProjectId: 'proj-1', keyKind: 'tmp', claimToken: 'tok-1' })]),
    )
    // 2: /api/v1/public/instant-db/claim POST → 200
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ api_key: 'sk_new' }),
    } as unknown as Response)
    // 3: registerApp POST (flip to permanent)
    fetchMock.mockResolvedValueOnce(okResponse())

    const res = await claimCompanyProject('acme', 'valid-jwt')
    expect(res.ok).toBe(true)
    expect(res.claimed).toBe(true)

    const posts = fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'POST')
    const lastPost = posts[posts.length - 1]
    const body = JSON.parse(String(lastPost[1].body))
    expect(body.row_data.keyKind).toBe('permanent')
    expect(body.row_data.claimToken).toBeUndefined()
    expect(body.row_data.claimedAt).toBeTruthy()
  })

  it('treats 409 (already claimed externally) as idempotent success with claimed=false', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([row('acme', { zerodbProjectId: 'proj-1', keyKind: 'tmp', claimToken: 'tok-1' })]),
    )
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 409, json: async () => ({ detail: 'already claimed' }),
    } as unknown as Response)
    fetchMock.mockResolvedValueOnce(okResponse())

    const res = await claimCompanyProject('acme', 'jwt-token')
    expect(res.ok).toBe(true)
    expect(res.claimed).toBe(false)
  })

  it('returns an error reason on a non-ok non-409 response from the claim endpoint', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([row('acme', { zerodbProjectId: 'proj-1', keyKind: 'tmp', claimToken: 'tok-1' })]),
    )
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 403, json: async () => ({ detail: 'invalid token' }),
    } as unknown as Response)

    const res = await claimCompanyProject('acme', 'bad-jwt')
    expect(res.ok).toBe(false)
    expect(res.claimed).toBe(false)
    expect(res.reason).toBeTruthy()
  })

  it('returns an error reason without throwing when fetch rejects (network error)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([row('acme', { zerodbProjectId: 'proj-1', keyKind: 'tmp', claimToken: 'tok-1' })]),
    )
    fetchMock.mockRejectedValueOnce(new Error('network error'))

    const res = await claimCompanyProject('acme', 'jwt-token')
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('network error')
  })
})
