import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// gitea-client.ts captures GITEA_BASE_URL/GITEA_ADMIN_TOKEN at MODULE LOAD
// (const), so they must be set BEFORE the import executes (see
// gitea-client-354.test.ts's own note on this pattern for app-registry.ts).
vi.hoisted(() => {
  process.env.GITEA_BASE_URL = 'https://git.ainative.studio'
  process.env.GITEA_ADMIN_TOKEN = 'test-admin-token'
})

import { getCommitsSince } from '@/lib/git/gitea-client'

/**
 * #743 — getCommitsSince(org, repo, sinceIso).
 *
 * VERIFIED LIVE (2026-09-14) against the real Gitea instance at
 * git.ainative.studio (version 1.22.6, via GET /api/v1/version and the real
 * swagger spec at /swagger.v1.json): `GET /repos/{owner}/{repo}/commits` has
 * NO `since` query parameter — only `sha`, `path`, `stat`, `verification`,
 * `files`, `page`, `limit`, `not`. So getCommitsSince pages through commits
 * (Gitea's default newest-first order) and filters CLIENT-SIDE, stopping as
 * soon as it sees a commit older than `sinceIso`. These tests mock the HTTP
 * response directly — no real network call.
 */

function commit(sha: string, dateIso: string, message = 'a change') {
  return {
    sha,
    html_url: `https://git.ainative.studio/ws-1/acme/commit/${sha}`,
    commit: {
      message,
      author: { name: 'Cody', email: 'cody@ainative.studio', date: dateIso },
      committer: { name: 'Cody', email: 'cody@ainative.studio', date: dateIso },
    },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

describe('getCommitsSince (#743)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns [] when unconfigured, org/repo missing, or sinceIso invalid', async () => {
    expect(await getCommitsSince('', 'acme', '2026-09-01T00:00:00Z')).toEqual([])
    expect(await getCommitsSince('ws-1', '', '2026-09-01T00:00:00Z')).toEqual([])
    expect(await getCommitsSince('ws-1', 'acme', '')).toEqual([])
    expect(await getCommitsSince('ws-1', 'acme', 'not-a-date')).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns [] on a 404 (repo not found) — never throws', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404))
    const result = await getCommitsSince('ws-1', 'acme', '2026-09-01T00:00:00Z')
    expect(result).toEqual([])
  })

  it('returns [] on a 409 (EmptyRepository — a real, expected Gitea response)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 409))
    const result = await getCommitsSince('ws-1', 'acme', '2026-09-01T00:00:00Z')
    expect(result).toEqual([])
  })

  it('throws on a genuine API failure (e.g. 401/500) — a real outage must be visible', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500))
    await expect(getCommitsSince('ws-1', 'acme', '2026-09-01T00:00:00Z')).rejects.toThrow()
  })

  it('returns all commits newer than sinceIso from a single page', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse([
      commit('abc1111', '2026-09-14T10:00:00Z', 'fix bug'),
      commit('abc2222', '2026-09-13T10:00:00Z', 'add feature'),
    ]))
    const result = await getCommitsSince('ws-1', 'acme', '2026-09-12T00:00:00Z')
    expect(result).toHaveLength(2)
    expect(result[0].sha).toBe('abc1111')
  })

  it('stops as soon as it sees a commit OLDER than sinceIso, without paging further', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse([
      commit('new1', '2026-09-14T10:00:00Z'),
      commit('new2', '2026-09-13T10:00:00Z'),
      commit('old1', '2026-09-01T10:00:00Z'), // older than sinceIso — cuts here
      commit('old2', '2026-08-01T10:00:00Z'),
    ]))
    const result = await getCommitsSince('ws-1', 'acme', '2026-09-10T00:00:00Z')
    expect(result.map((c) => c.sha)).toEqual(['new1', 'new2'])
    // Only ONE page fetched — it stopped rather than requesting page 2.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns [] when the only commits are older than sinceIso', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse([
      commit('old1', '2026-01-01T00:00:00Z'),
    ]))
    const result = await getCommitsSince('ws-1', 'acme', '2026-09-01T00:00:00Z')
    expect(result).toEqual([])
  })

  it('pages through multiple full pages when every commit on a page is newer than sinceIso', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const page1 = Array.from({ length: 50 }, (_, i) => commit(`p1-${i}`, '2026-09-14T00:00:00Z'))
    const page2 = [commit('p2-0', '2026-09-13T00:00:00Z')]
    fetchMock.mockResolvedValueOnce(jsonResponse(page1))
    fetchMock.mockResolvedValueOnce(jsonResponse(page2))
    const result = await getCommitsSince('ws-1', 'acme', '2026-09-01T00:00:00Z')
    expect(result).toHaveLength(51)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('calls the real commits endpoint with speedup flags and no since param (verified: Gitea has none)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await getCommitsSince('ws-1', 'Acme', '2026-09-01T00:00:00Z')
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/repos/ws-1/acme/commits')
    expect(url).toContain('stat=false')
    expect(url).toContain('verification=false')
    expect(url).toContain('files=false')
    expect(url).not.toContain('since=')
  })

  it('stops after MAX_COMMITS_PAGES even if every page is full and newer (safety cap)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const fullNewPage = () => Array.from({ length: 50 }, (_, i) => commit(`x-${i}-${Math.random()}`, '2026-09-14T00:00:00Z'))
    for (let i = 0; i < 15; i++) fetchMock.mockResolvedValueOnce(jsonResponse(fullNewPage()))
    const result = await getCommitsSince('ws-1', 'acme', '2020-01-01T00:00:00Z')
    // Capped at MAX_COMMITS_PAGES (10) pages of 50 = 500, not unbounded.
    expect(result.length).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(10)
  })
})
