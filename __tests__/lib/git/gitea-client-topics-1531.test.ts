import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1531 — repos/search?topic=... is a REAL, live API a completely different
 * session used to try to answer "is this repo Builder's?" (confirmed against
 * git.ainative.studio's own swagger.v1.json: GET/PUT /repos/{owner}/{repo}/
 * topics and GET /topics/search are genuine endpoints on the live instance).
 * Before this, createRepo()'s free-text description ("AINative company:
 * {slug}") identified the COMPANY but never Builder's own ownership, and
 * nothing was filterable/searchable — a peer session had to ask across
 * sessions instead of self-verifying via the API.
 *
 * setRepoTopics() stamps a searchable Builder-ownership topic on every
 * provisioned repo. Mirrors createRepoWebhook (#1092)'s own test style and
 * best-effort/never-blocks contract exactly.
 */

vi.hoisted(() => {
  process.env.GITEA_BASE_URL = 'https://git.example.test'
  process.env.GITEA_ADMIN_TOKEN = 'test-admin-token'
})

import { setRepoTopics, BUILDER_REPO_TOPIC, provisionCompanyRepo } from '@/lib/git/gitea-client'

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('BUILDER_REPO_TOPIC (#1531)', () => {
  it('is a real, stable, machine-filterable slug — not empty, not whitespace', () => {
    expect(BUILDER_REPO_TOPIC).toBe('ainative-builder')
  })
})

describe('setRepoTopics (#1531)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('PUTs the real Gitea topics-replace shape, defaulting to BUILDER_REPO_TOPIC', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(204, undefined))

    const result = await setRepoTopics('ws-acme', 'acme')

    expect(result.ok).toBe(true)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe('https://git.example.test/api/v1/repos/ws-acme/acme/topics')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({ topics: ['ainative-builder'] })
  })

  it('accepts additional real topics alongside the Builder marker', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(204, undefined))
    await setRepoTopics('ws-acme', 'acme', ['ainative-builder', 'company-app'])
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual({ topics: ['ainative-builder', 'company-app'] })
  })

  it('sanitizes the repo name via repoNameForSlug', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(204, undefined))
    await setRepoTopics('ws-acme', 'My Company!!')
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/repos/ws-acme/my-company/topics')
  })

  it('returns {ok:false, reason} on a genuine non-ok failure — never throws', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(422, { message: 'invalid topic' }))
    const result = await setRepoTopics('ws-acme', 'acme')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('422')
  })

  it('returns {ok:false, reason} when fetch throws (network error), never propagates', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNRESET'))
    const result = await setRepoTopics('ws-acme', 'acme')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('ECONNRESET')
  })

  it('rejects a missing org without calling fetch', async () => {
    const result = await setRepoTopics('', 'acme')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_org')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns {ok:false, reason:"not_configured"} when GITEA_BASE_URL/TOKEN are unset', async () => {
    vi.resetModules()
    const originalEnv = process.env
    process.env = { ...originalEnv, GITEA_BASE_URL: '', GITEA_ADMIN_TOKEN: '' }
    const { setRepoTopics: setRepoTopicsUnconfigured } = await import('@/lib/git/gitea-client')
    const result = await setRepoTopicsUnconfigured('ws-acme', 'acme')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_configured')
    process.env = originalEnv
  })
})

describe('provisionCompanyRepo wires in setRepoTopics (#1531)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('stamps the Builder topic after org+repo+webhook succeed', async () => {
    vi.mocked(fetch)
      // ensureOrg: pre-flight GET (not found) -> create
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(201, { id: 1, username: 'ws-acme' }))
      // createRepo: pre-flight GET (not found) -> create
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(
        jsonResponse(201, { id: 10, name: 'acme', full_name: 'ws-acme/acme', private: true, clone_url: 'x', html_url: 'y' }),
      )
      // createRepoWebhook: pre-flight GET (none) -> create succeeds
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(
        jsonResponse(201, { id: 5, type: 'gitea', config: { url: 'x' }, events: ['push', 'pull_request'], active: true }),
      )
      // setRepoTopics: PUT succeeds
      .mockResolvedValueOnce(jsonResponse(204, undefined))

    const result = await provisionCompanyRepo('acme-workspace', 'acme')

    expect(result?.org.username).toBe('ws-acme')
    expect(result?.repo.name).toBe('acme')
    expect(fetch).toHaveBeenCalledTimes(7)
    const lastCall = vi.mocked(fetch).mock.calls[6]
    expect(String(lastCall[0])).toContain('/topics')
    expect(lastCall[1]?.method).toBe('PUT')
  })

  it('still returns the org+repo when the topics step fails — never blocks provisioning', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(201, { id: 1, username: 'ws-acme' }))
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(
        jsonResponse(201, { id: 10, name: 'acme', full_name: 'ws-acme/acme', private: true, clone_url: 'x', html_url: 'y' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(
        jsonResponse(201, { id: 5, type: 'gitea', config: { url: 'x' }, events: ['push', 'pull_request'], active: true }),
      )
      // setRepoTopics PUT fails
      .mockResolvedValueOnce(jsonResponse(500, { message: 'gitea down' }))

    const result = await provisionCompanyRepo('acme-workspace', 'acme')

    expect(result?.org.username).toBe('ws-acme')
    expect(result?.repo.name).toBe('acme')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('setRepoTopics failed'))
  })
})
