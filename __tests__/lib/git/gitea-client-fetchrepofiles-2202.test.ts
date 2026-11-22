import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #2202 — fetchRepoFiles()'s Gitea tree lookup: a 404 (repo/branch not found)
 * stays a normal, non-throwing `null` ("not provisioned yet"); any other
 * non-ok status now throws the distinct, named `GiteaTreeLookupError`
 * (carrying org/repo/status) instead of a bare `Error`, so a caller can tell
 * "this repo IS configured but its tree lookup is genuinely broken" apart
 * from any other unexpected throw. Mirrors createIssue's own test style
 * (#744) — configured() needs real GITEA_* env, stubbed before import, with
 * the module-level fetch used by giteaFetch mocked per test.
 */

vi.hoisted(() => {
  process.env.GITEA_BASE_URL = 'https://git.example.test'
  process.env.GITEA_ADMIN_TOKEN = 'test-admin-token'
})

import { fetchRepoFiles, GiteaTreeLookupError, isGiteaTreeLookupError } from '@/lib/git/gitea-client'

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('fetchRepoFiles tree-lookup error shape (#2202)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns null (no throw) on a 404 tree lookup — missing repo/branch is a normal state', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(404, { message: 'not found' }, false))
    const result = await fetchRepoFiles('ws-acme', 'acme')
    expect(result).toBeNull()
  })

  it('throws a GiteaTreeLookupError (not a bare Error) on a 400 tree lookup, carrying org/repo/status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(400, { message: 'bad ref' }, false))
    await expect(fetchRepoFiles('ws-acme', 'acme')).rejects.toSatisfy((err: unknown) => {
      expect(isGiteaTreeLookupError(err)).toBe(true)
      const treeErr = err as GiteaTreeLookupError
      expect(treeErr.org).toBe('ws-acme')
      expect(treeErr.repo).toBe('acme')
      expect(treeErr.status).toBe(400)
      expect(treeErr.message).toContain('400')
      return true
    })
  })

  it('throws a GiteaTreeLookupError for a non-400 server error too (e.g. 500), with the real status attached', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(500, { message: 'oops' }, false))
    await expect(fetchRepoFiles('ws-acme', 'acme')).rejects.toSatisfy((err: unknown) => {
      expect(isGiteaTreeLookupError(err)).toBe(true)
      expect((err as GiteaTreeLookupError).status).toBe(500)
      return true
    })
  })

  it('isGiteaTreeLookupError returns false for an unrelated error', () => {
    expect(isGiteaTreeLookupError(new Error('something else'))).toBe(false)
    expect(isGiteaTreeLookupError(null)).toBe(false)
  })

  it('returns a real files map on a successful tree + content fetch (unaffected by the error-shape change)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(200, { sha: 'abc', tree: [{ path: 'a.ts', type: 'blob', sha: 's1', size: 10 }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { content: Buffer.from('hello').toString('base64'), encoding: 'base64' }),
      )
    const result = await fetchRepoFiles('ws-acme', 'acme')
    expect(result).toEqual({ 'a.ts': 'hello' })
  })
})
