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
