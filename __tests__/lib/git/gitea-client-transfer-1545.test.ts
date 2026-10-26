import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1545 — transferRepo() on the Gitea client: moves a company's repo between
 * orgs (history/issues/PRs/branches travel with it, per Gitea's real
 * transfer semantics), used by the one-time migration backfill that moves
 * repos provisioned before #1543/#1544 out of the single shared platform
 * org into their real founder's own workspace org.
 *
 * Mirrors createRepoWebhook (#1092)'s own test style: configured() is always
 * false in this test env unless GITEA_* is hoisted-set; success/idempotency/
 * missing-source/thrown-error paths are covered by mocking the module-level
 * fetch used by giteaFetch.
 */

vi.hoisted(() => {
  process.env.GITEA_BASE_URL = 'https://git.example.test'
  process.env.GITEA_ADMIN_TOKEN = 'test-admin-token'
})

import { transferRepo } from '@/lib/git/gitea-client'

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('transferRepo (#1545)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('transfers a repo from the shared org to the founder workspace org', async () => {
    // Pre-flight: not already in the destination org.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(404, { message: 'not found' }))
    // Source repo exists under the shared org.
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { id: 1, name: 'acme', full_name: 'ws-builder-shared/acme', private: true, clone_url: 'https://git.example.test/ws-builder-shared/acme.git', html_url: 'https://git.example.test/ws-builder-shared/acme' }),
    )
    // Transfer call succeeds, returns the repo under its new owner.
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(202, { id: 1, name: 'acme', full_name: 'ws-founder123/acme', private: true, clone_url: 'https://git.example.test/ws-founder123/acme.git', html_url: 'https://git.example.test/ws-founder123/acme' }),
    )

    const result = await transferRepo('ws-builder-shared', 'ws-founder123', 'acme')
    expect(result?.full_name).toBe('ws-founder123/acme')

    const transferCall = vi.mocked(fetch).mock.calls[2]
    expect(String(transferCall[0])).toBe('https://git.example.test/api/v1/repos/ws-builder-shared/acme/transfer')
    expect(JSON.parse(String((transferCall[1] as RequestInit).body))).toEqual({ new_owner: 'ws-founder123' })
  })

  it('is idempotent: a repo already under the destination org is a no-op success, no transfer call made', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { id: 1, name: 'acme', full_name: 'ws-founder123/acme', private: true, clone_url: 'x', html_url: 'x' }),
    )

    const result = await transferRepo('ws-builder-shared', 'ws-founder123', 'acme')
    expect(result?.full_name).toBe('ws-founder123/acme')
    expect(fetch).toHaveBeenCalledTimes(1) // only the destination pre-flight GET — no transfer call
  })

  it('returns null (not an error) when the source repo genuinely does not exist under fromOrg', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(404, { message: 'not found' })) // destination check
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(404, { message: 'not found' })) // source check

    const result = await transferRepo('ws-builder-shared', 'ws-founder123', 'ghost-co')
    expect(result).toBeNull()
  })

  it('throws on a genuine transfer failure (e.g. a name collision Gitea refuses)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(404, { message: 'not found' })) // destination check
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { id: 1, name: 'acme', full_name: 'ws-builder-shared/acme', private: true, clone_url: 'x', html_url: 'x' }),
    ) // source exists
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(422, { message: 'repository name already exists' }))

    await expect(transferRepo('ws-builder-shared', 'ws-founder123', 'acme')).rejects.toThrow(/transferRepo/)
  })

  it('returns null without calling fetch when Gitea is unconfigured', async () => {
    vi.resetModules()
    const prevUrl = process.env.GITEA_BASE_URL
    const prevToken = process.env.GITEA_ADMIN_TOKEN
    delete process.env.GITEA_BASE_URL
    delete process.env.GITEA_ADMIN_TOKEN
    const { transferRepo: unconfiguredTransfer } = await import('@/lib/git/gitea-client')
    const result = await unconfiguredTransfer('ws-a', 'ws-b', 'acme')
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    process.env.GITEA_BASE_URL = prevUrl
    process.env.GITEA_ADMIN_TOKEN = prevToken
  })

  it('returns null without calling fetch for missing org inputs', async () => {
    const result = await transferRepo('', 'ws-founder123', 'acme')
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
