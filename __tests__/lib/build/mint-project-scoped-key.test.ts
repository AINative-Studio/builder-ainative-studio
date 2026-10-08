import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1013 — minting a fresh project-scoped data-plane key for a company's
 * ALREADY-EXISTING ZeroDB project.
 *
 * WHY THIS EXISTS AT ALL. #806's store is written from exactly one place: the
 * provision path, with the key that `provisionInstantDb` happened to mint while
 * CREATING the project. For a company provisioned before #806 shipped, that key
 * was handed back once and discarded — it is unrecoverable. The project itself
 * still exists and still holds the founder's real data, so re-provisioning
 * (creating a NEW project) would silently orphan it. The only correct repair is
 * to mint a NEW key SCOPED TO THE EXISTING PROJECT, which core exposes as
 * `POST /api/v1/public/api-keys { name, project_id }` (confirmed against core's
 * live openapi.json: 201 → APIKeyCreateResponse carrying the full `api_key`
 * once; 404 "Project not found or access denied"; 400 invalid project_id).
 *
 * Deliberately NOT the instant-db claim path: that needs the founder's own
 * bearer token (the claim associates a project to a specific real account), and
 * no offline sweep may legitimately borrow a founder's identity (CODY.md Rule
 * 5). This mint uses Builder's OWN service identity against a project Builder's
 * identity can already reach — and fails honestly with 404 when it cannot.
 */

beforeEach(() => {
  vi.resetModules()
  process.env.ZERODB_API_KEY = 'shared-service-key'
  process.env.ZERODB_PROJECT_ID = 'builder-registry-project'
  delete process.env.AINATIVE_API_URL
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function load() {
  return await import('@/lib/build/company-zerodb-credentials')
}

describe('mintProjectScopedKey', () => {
  it('POSTs to core api-keys with the target project_id and returns the real minted key', async () => {
    const calls: Array<{ url: string; method?: string; headers: any; body: any }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        calls.push({
          url: String(url),
          method: init?.method,
          headers: init?.headers,
          body: init?.body ? JSON.parse(init.body) : null,
        })
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'key-1',
            name: 'builder-backfill',
            api_key: 'sk_live_minted_for_existing_project',
            key_preview: 'sk_live…',
            is_active: true,
            created_at: '2026-10-07T00:00:00Z',
            project_id: 'company-project-1',
          }),
        }
      }),
    )

    const { mintProjectScopedKey } = await load()
    const r = await mintProjectScopedKey('company-project-1', { slug: 'agentive' })

    expect(r.ok).toBe(true)
    expect(r.apiKey).toBe('sk_live_minted_for_existing_project')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.ainative.studio/api/v1/public/api-keys')
    expect(calls[0].method).toBe('POST')
    // Builder's OWN service identity — never a founder's borrowed token.
    expect(calls[0].headers['X-API-Key']).toBe('shared-service-key')
    expect(calls[0].body.project_id).toBe('company-project-1')
    // A human-traceable name, so an operator can see in core WHY this key exists.
    expect(String(calls[0].body.name)).toContain('agentive')
  })

  it('fails honestly (never fabricates a key) on a 404 — the project is gone or not reachable by this identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Project not found or access denied' }),
      })),
    )
    const { mintProjectScopedKey } = await load()
    const r = await mintProjectScopedKey('deleted-project')

    expect(r.ok).toBe(false)
    expect(r.apiKey).toBeUndefined()
    expect(r.status).toBe(404)
    expect(String(r.reason)).toContain('Project not found')
  })

  it('treats a 201 with no api_key in the body as a failure, not a success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: 'k', key_preview: 'sk_…' }) })),
    )
    const { mintProjectScopedKey } = await load()
    const r = await mintProjectScopedKey('p1')

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no_api_key_in_response')
  })

  it('refuses to call core at all when the mint would be mis-scoped: empty projectId', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { mintProjectScopedKey } = await load()
    const r = await mintProjectScopedKey('')

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no_project_id')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses to call core when Builder has no service key configured', async () => {
    delete process.env.ZERODB_API_KEY
    delete process.env.AINATIVE_API_KEY
    delete process.env.API_Key
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { mintProjectScopedKey } = await load()
    const r = await mintProjectScopedKey('p1')

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('unconfigured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws on a network failure — returns a structured failure instead', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    const { mintProjectScopedKey } = await load()
    const r = await mintProjectScopedKey('p1')

    expect(r.ok).toBe(false)
    expect(String(r.reason)).toContain('ECONNRESET')
  })
})

/**
 * SCOPE VERIFICATION (code-review HIGH finding).
 *
 * `project_id` is OPTIONAL and NULLABLE in BOTH `APIKeyCreateRequest` and
 * `APIKeyCreateResponse` in core's live openapi.json. Nothing in that contract
 * guarantees the key core hands back is actually scoped to the project_id we
 * asked for — a 201 can legitimately carry `project_id: null` (an
 * account-wide key) or, if core's own resolution ever drifts, a DIFFERENT
 * project id entirely.
 *
 * Accepting such a key is strictly WORSE than leaving the company broken, and
 * this specific script is what makes it unrecoverable:
 *   1. the mis-scoped key gets written to builder_company_zerodb_keys,
 *   2. the sweep reports `backfilled` — a clean, successful-looking run,
 *   3. the next sweep sees a stored key and reports `already_stored`, so the
 *      company is never retried: idempotency now cements the damage,
 *   4. and the company's real /api/db calls move from an honest, diagnosable
 *      502 KEY_UNAVAILABLE to ZeroDB's 403 API_KEY_PROJECT_MISMATCH — the exact
 *      cross-tenant mis-scoping #806 existed to eliminate.
 *
 * So the response's OWN project_id must match the requested projectId exactly,
 * and anything else is a failure BEFORE the key can ever reach the store.
 */
describe('mintProjectScopedKey — response scope verification', () => {
  function stubMint(body: any, status = 201) {
    const fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('rejects a 201 whose project_id is null — an unscoped/account-wide key must never be stored', async () => {
    stubMint({ id: 'k', api_key: 'sk_live_account_wide', project_id: null })
    const { mintProjectScopedKey } = await load()
    const r = await mintProjectScopedKey('company-project-1', { slug: 'agentive' })

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('scope_mismatch')
    // The key must not leak out on the failure path — the caller stores
    // `minted.apiKey` whenever it is present.
    expect(r.apiKey).toBeUndefined()
    expect(r.status).toBe(201)
  })

  it('rejects a 201 with project_id omitted entirely from the response body', async () => {
    stubMint({ id: 'k', api_key: 'sk_live_no_scope_field' })
    const { mintProjectScopedKey } = await load()
    const r = await mintProjectScopedKey('company-project-1')

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('scope_mismatch')
    expect(r.apiKey).toBeUndefined()
  })

  it('rejects a 201 scoped to a DIFFERENT project than the one requested', async () => {
    stubMint({ id: 'k', api_key: 'sk_live_someone_elses_project', project_id: 'some-other-project' })
    const { mintProjectScopedKey } = await load()
    const r = await mintProjectScopedKey('company-project-1')

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('scope_mismatch')
    expect(r.apiKey).toBeUndefined()
  })

  it('accepts a 201 whose project_id matches the requested project exactly (happy path intact)', async () => {
    stubMint({ id: 'k', api_key: 'sk_live_correctly_scoped', project_id: 'company-project-1' })
    const { mintProjectScopedKey } = await load()
    const r = await mintProjectScopedKey('company-project-1')

    expect(r.ok).toBe(true)
    expect(r.apiKey).toBe('sk_live_correctly_scoped')
  })
})
