import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1092 — createRepoWebhook() / getRepoWebhooks() on the Gitea client: the
 * piece that was entirely missing. Two independent investigations confirmed
 * no Gitea webhook was configured on any real company repo in production,
 * and no code anywhere created one — app/api/webhooks/gitea/route.ts (the
 * committee PR gate + #1091's build_tasks sync) was silently never called.
 *
 * Mirrors createIssue (#744)'s own test style exactly: configured() is
 * always false in this test env unless GITEA_* is hoisted-set; success/
 * failure/thrown-error/idempotency paths are covered by mocking the
 * module-level fetch used by giteaFetch.
 */

vi.hoisted(() => {
  process.env.GITEA_BASE_URL = 'https://git.example.test'
  process.env.GITEA_ADMIN_TOKEN = 'test-admin-token'
})

import { createRepoWebhook, getRepoWebhooks, webhookTargetUrl, provisionCompanyRepo } from '@/lib/git/gitea-client'

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const TARGET = 'https://builder.ainative.studio/api/webhooks/gitea'

describe('getRepoWebhooks (#1092)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lists hooks on a repo', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, [
        { id: 1, type: 'gitea', config: { url: TARGET }, events: ['push', 'pull_request'], active: true },
      ]),
    )
    const hooks = await getRepoWebhooks('ws-acme', 'acme')
    expect(hooks).toHaveLength(1)
    expect(hooks[0].config.url).toBe(TARGET)

    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe('https://git.example.test/api/v1/repos/ws-acme/acme/hooks')
  })

  it('returns [] on a non-ok response, never throws', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(404, { message: 'not found' }))
    const hooks = await getRepoWebhooks('ws-acme', 'ghost-co')
    expect(hooks).toEqual([])
  })

  it('returns [] when fetch throws, never propagates', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNRESET'))
    const hooks = await getRepoWebhooks('ws-acme', 'acme')
    expect(hooks).toEqual([])
  })

  it('returns [] without calling fetch for a missing org', async () => {
    const hooks = await getRepoWebhooks('', 'acme')
    expect(hooks).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('createRepoWebhook (#1092)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('creates a webhook with the real Gitea request shape when none exists', async () => {
    // Pre-flight GET finds nothing.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    // Create succeeds.
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(201, {
        id: 7,
        type: 'gitea',
        config: { url: TARGET, content_type: 'json' },
        events: ['push', 'pull_request'],
        active: true,
      }),
    )

    const result = await createRepoWebhook('ws-acme', 'acme', TARGET, 'shh-secret')

    expect(result.ok).toBe(true)
    expect(result.hook?.id).toBe(7)

    // Second fetch call is the real POST — verify exact Gitea contract shape.
    const [url, init] = vi.mocked(fetch).mock.calls[1]
    expect(String(url)).toBe('https://git.example.test/api/v1/repos/ws-acme/acme/hooks')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({
      type: 'gitea',
      config: { url: TARGET, content_type: 'json', secret: 'shh-secret' },
      events: ['push', 'pull_request'],
      active: true,
    })
  })

  it('is idempotent — does not create a duplicate when a matching-URL hook already exists', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, [
        { id: 3, type: 'gitea', config: { url: TARGET }, events: ['push'], active: true },
      ]),
    )

    const result = await createRepoWebhook('ws-acme', 'acme', TARGET, 'shh-secret')

    expect(result.ok).toBe(true)
    expect(result.hook?.id).toBe(3)
    // Only the pre-flight GET — no POST (create) call made.
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not match a hook pointed at a DIFFERENT url, and creates a new one', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, [{ id: 1, type: 'slack', config: { url: 'https://hooks.slack.com/x' }, events: [], active: true }]),
    )
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(201, { id: 8, type: 'gitea', config: { url: TARGET }, events: ['push', 'pull_request'], active: true }),
    )

    const result = await createRepoWebhook('ws-acme', 'acme', TARGET, 'secret')
    expect(result.ok).toBe(true)
    expect(result.hook?.id).toBe(8)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('re-fetches and returns the existing hook on a 409 race', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [])) // pre-flight: nothing yet
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(409, { message: 'already exists' })) // raced create
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, [{ id: 9, type: 'gitea', config: { url: TARGET }, events: ['push', 'pull_request'], active: true }]),
    ) // re-fetch finds it

    const result = await createRepoWebhook('ws-acme', 'acme', TARGET, 'secret')
    expect(result.ok).toBe(true)
    expect(result.hook?.id).toBe(9)
  })

  it('returns {ok:false, reason} on a genuine non-ok, non-409 failure — never throws', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(500, { message: 'internal error' }))

    const result = await createRepoWebhook('ws-acme', 'acme', TARGET, 'secret')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('500')
  })

  it('returns {ok:false, reason} when fetch throws (network error), never propagates', async () => {
    // Pre-flight getRepoWebhooks() has its own try/catch (degrades to []), so
    // the network error that must surface here is the one on the create POST.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNRESET'))
    const result = await createRepoWebhook('ws-acme', 'acme', TARGET, 'secret')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('ECONNRESET')
  })

  it('rejects a missing target URL without calling fetch', async () => {
    const result = await createRepoWebhook('ws-acme', 'acme', '', 'secret')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_target_url')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a missing org without calling fetch', async () => {
    const result = await createRepoWebhook('', 'acme', TARGET, 'secret')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_org')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sanitizes the repo name via repoNameForSlug', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(201, { id: 1, type: 'gitea', config: { url: TARGET }, events: [], active: true }))
    await createRepoWebhook('ws-acme', 'My Company!!', TARGET, 'secret')
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/repos/ws-acme/my-company/hooks')
  })

  it('still creates the hook when secret is empty (never blocks on a missing secret)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(201, { id: 2, type: 'gitea', config: { url: TARGET }, events: [], active: true }))
    const result = await createRepoWebhook('ws-acme', 'acme', TARGET, '')
    expect(result.ok).toBe(true)
    const [, init] = vi.mocked(fetch).mock.calls[1]
    const body = JSON.parse(String(init?.body))
    expect(body.config.secret).toBe('')
  })
})

describe('createRepoWebhook (#1092) — unconfigured degradation', () => {
  it('returns {ok:false, reason:"not_configured"} when GITEA_BASE_URL/TOKEN are unset', async () => {
    vi.resetModules()
    const originalEnv = process.env
    process.env = { ...originalEnv, GITEA_BASE_URL: '', GITEA_ADMIN_TOKEN: '' }
    const { createRepoWebhook: createRepoWebhookUnconfigured } = await import('@/lib/git/gitea-client')
    const result = await createRepoWebhookUnconfigured('ws-acme', 'acme', TARGET, 'secret')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_configured')
    process.env = originalEnv
  })
})

describe('provisionCompanyRepo wires in createRepoWebhook (#1092)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('registers the webhook after org+repo creation succeed', async () => {
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
        jsonResponse(201, { id: 5, type: 'gitea', config: { url: TARGET }, events: ['push', 'pull_request'], active: true }),
      )

    const result = await provisionCompanyRepo('acme-workspace', 'acme')

    expect(result?.org.username).toBe('ws-acme')
    expect(result?.repo.name).toBe('acme')
    // 6 calls total: ensureOrg(2) + createRepo(2) + webhook(2)
    expect(fetch).toHaveBeenCalledTimes(6)
    const lastCall = vi.mocked(fetch).mock.calls[5]
    expect(String(lastCall[0])).toContain('/hooks')
  })

  it('still returns the org+repo when the webhook step fails — never blocks provisioning', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(201, { id: 1, username: 'ws-acme' }))
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(
        jsonResponse(201, { id: 10, name: 'acme', full_name: 'ws-acme/acme', private: true, clone_url: 'x', html_url: 'y' }),
      )
      // webhook pre-flight GET fails outright (500) -> getRepoWebhooks degrades to []
      .mockResolvedValueOnce(jsonResponse(500, { message: 'gitea down' }))
      // webhook create also fails
      .mockResolvedValueOnce(jsonResponse(500, { message: 'gitea down' }))

    const result = await provisionCompanyRepo('acme-workspace', 'acme')

    expect(result?.org.username).toBe('ws-acme')
    expect(result?.repo.name).toBe('acme')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('createRepoWebhook failed'))
  })
})

describe('webhookTargetUrl (#1092, pure)', () => {
  const originalEnv = process.env
  afterEach(() => {
    process.env = originalEnv
  })

  it('falls back to the production Builder URL when NEXT_PUBLIC_APP_URL is unset', async () => {
    vi.resetModules()
    process.env = { ...originalEnv, NEXT_PUBLIC_APP_URL: '' }
    const { webhookTargetUrl: fn } = await import('@/lib/git/gitea-client')
    expect(fn()).toBe('https://builder.ainative.studio/api/webhooks/gitea')
  })

  it('uses NEXT_PUBLIC_APP_URL when set, stripping a trailing slash', async () => {
    vi.resetModules()
    process.env = { ...originalEnv, NEXT_PUBLIC_APP_URL: 'https://staging.example.test/' }
    const { webhookTargetUrl: fn } = await import('@/lib/git/gitea-client')
    expect(fn()).toBe('https://staging.example.test/api/webhooks/gitea')
  })
})
