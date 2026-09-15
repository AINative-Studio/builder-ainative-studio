import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #744 — createIssue() on the Gitea client: a founder texts Cody a quick
 * feature idea, and it becomes a real tracked issue in that company's own
 * Gitea repo. Mirrors createRepo/createTaskPR's own test style — configured()
 * is always false in this test env (no GITEA_* set), so the "unconfigured"
 * branch is real coverage; success/failure/thrown-error paths are covered by
 * mocking the module-level fetch used by giteaFetch.
 */

vi.hoisted(() => {
  process.env.GITEA_BASE_URL = 'https://git.example.test'
  process.env.GITEA_ADMIN_TOKEN = 'test-admin-token'
})

import { createIssue } from '@/lib/git/gitea-client'

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('createIssue (#744)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('creates an issue and returns {ok:true, issueNumber, url} on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(201, {
        id: 999,
        number: 42,
        title: 'Add dark mode',
        state: 'open',
        html_url: 'https://git.example.test/ws-acme/acme/issues/42',
      }),
    )

    const result = await createIssue('ws-acme', 'acme', 'Add dark mode', 'Founder texted this in.')

    expect(result.ok).toBe(true)
    expect(result.issueNumber).toBe(42)
    expect(result.url).toBe('https://git.example.test/ws-acme/acme/issues/42')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe('https://git.example.test/api/v1/repos/ws-acme/acme/issues')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ title: 'Add dark mode', body: 'Founder texted this in.' })
    expect((init?.headers as Record<string, string>).Authorization).toBe('token test-admin-token')
  })

  it('returns {ok:false, reason} on a non-ok response, never throws', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(404, { message: 'repo not found' }))

    const result = await createIssue('ws-acme', 'ghost-co', 'Some idea', 'body text')

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('404')
    expect(result.issueNumber).toBeUndefined()
  })

  it('returns {ok:false, reason} when the response is ok but missing an issue number', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(201, { id: 1, title: 'x' }))

    const result = await createIssue('ws-acme', 'acme', 'title', 'body')

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('create_response_missing_number')
  })

  it('returns {ok:false, reason} when fetch throws (network error), never propagates', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNRESET'))

    const result = await createIssue('ws-acme', 'acme', 'title', 'body')

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('ECONNRESET')
  })

  it('rejects an empty title without calling fetch', async () => {
    const result = await createIssue('ws-acme', 'acme', '   ', 'body')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_title')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a missing org without calling fetch', async () => {
    const result = await createIssue('', 'acme', 'title', 'body')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_org')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sanitizes the repo name via repoNameForSlug', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(201, { id: 1, number: 1, html_url: 'https://git.example.test/ws-acme/my-company/issues/1' }),
    )
    await createIssue('ws-acme', 'My Company!!', 'title', 'body')
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/repos/ws-acme/my-company/issues')
  })
})

describe('createIssue (#744) — unconfigured degradation', () => {
  it('returns {ok:false, reason:"not_configured"} when GITEA_BASE_URL/TOKEN are unset', async () => {
    vi.resetModules()
    const originalEnv = process.env
    process.env = { ...originalEnv, GITEA_BASE_URL: '', GITEA_ADMIN_TOKEN: '' }
    const { createIssue: createIssueUnconfigured } = await import('@/lib/git/gitea-client')
    const result = await createIssueUnconfigured('ws-acme', 'acme', 'title', 'body')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_configured')
    process.env = originalEnv
  })
})
