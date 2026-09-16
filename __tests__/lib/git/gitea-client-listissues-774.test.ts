import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #774 (Gap 2) — listIssues() on the Gitea client: grounds Cody's "I'll wire
 * that" / "it's in the queue" claims in the founder's own REAL backlog
 * instead of a synthetic, always-the-same list. Mirrors createIssue's own
 * test style — configured() is always false in this test env (no GITEA_*
 * set), so the "unconfigured" branch is real coverage; success/failure/
 * thrown-error paths are covered by mocking the module-level fetch used by
 * giteaFetch.
 */

vi.hoisted(() => {
  process.env.GITEA_BASE_URL = 'https://git.example.test'
  process.env.GITEA_ADMIN_TOKEN = 'test-admin-token'
})

import { listIssues } from '@/lib/git/gitea-client'

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const SAMPLE_ISSUES = [
  { id: 1, number: 5, title: 'Add dark mode', state: 'open', html_url: 'https://git.example.test/ws-acme/acme/issues/5' },
  { id: 2, number: 4, title: 'Wire Stripe', state: 'closed', html_url: 'https://git.example.test/ws-acme/acme/issues/4' },
]

describe('listIssues (#774)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns {ok:true, issues} on success, defaulting to state=all', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, SAMPLE_ISSUES))

    const result = await listIssues('ws-acme', 'acme')

    expect(result.ok).toBe(true)
    expect(result.issues).toEqual(SAMPLE_ISSUES)
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/repos/ws-acme/acme/issues')
    expect(String(url)).toContain('state=all')
  })

  it('passes through an explicit state and limit', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    await listIssues('ws-acme', 'acme', { state: 'open', limit: 5 })
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('state=open')
    expect(String(url)).toContain('limit=5')
  })

  it('clamps an out-of-range limit into [1,50]', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    await listIssues('ws-acme', 'acme', { limit: 500 })
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('limit=50')
  })

  it('returns {ok:false, reason} on a non-ok response, never throws', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(404, { message: 'repo not found' }))
    const result = await listIssues('ws-acme', 'ghost-co')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('404')
    expect(result.issues).toBeUndefined()
  })

  it('returns {ok:false, reason} when fetch throws (network error), never propagates', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNRESET'))
    const result = await listIssues('ws-acme', 'acme')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('ECONNRESET')
  })

  it('returns ok:true with an empty array when Gitea returns a genuinely empty repo', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    const result = await listIssues('ws-acme', 'acme')
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('rejects a missing org without calling fetch', async () => {
    const result = await listIssues('', 'acme')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_org')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sanitizes the repo name via repoNameForSlug', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))
    await listIssues('ws-acme', 'My Company!!')
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/repos/ws-acme/my-company/issues')
  })
})

describe('listIssues (#774) — unconfigured degradation', () => {
  it('returns {ok:false, reason:"not_configured"} when GITEA_BASE_URL/TOKEN are unset', async () => {
    vi.resetModules()
    const originalEnv = process.env
    process.env = { ...originalEnv, GITEA_BASE_URL: '', GITEA_ADMIN_TOKEN: '' }
    const { listIssues: listIssuesUnconfigured } = await import('@/lib/git/gitea-client')
    const result = await listIssuesUnconfigured('ws-acme', 'acme')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_configured')
    process.env = originalEnv
  })
})
