import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  configured,
  orgNameForWorkspace,
  repoNameForSlug,
  taskBranchName,
  filterFetchableBlobs,
  decodeGiteaContent,
  MAX_FETCHABLE_FILE_BYTES,
} from '@/lib/git/gitea-client'

/**
 * #354 GIT-1 — Gitea provisioning client tests. The network calls (ensureOrg,
 * createRepo, etc.) are thin fetch wrappers; these tests cover the PURE helpers
 * + the configured() guard + graceful degradation when GITEA_* are unset.
 */

describe('gitea-client (#354 GIT-1)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('configured()', () => {
    // Config is captured at module load time (const at top level, mirroring
    // app-registry.ts). Setting process.env in tests doesn't affect it. So we
    // just verify that IN THIS TEST ENV (no GITEA_* set) it returns false —
    // the correct degradation behavior. The "returns true when set" case is
    // implicitly proven by the network calls working on a live Gitea host.
    it('returns false when GITEA_BASE_URL/TOKEN are unset (the test env)', () => {
      expect(configured()).toBe(false)
    })
  })

  describe('orgNameForWorkspace (pure)', () => {
    it('produces a prefixed org name from a workspace id', () => {
      // The implementation adds a 'ws-' prefix and lowercases
      const org = orgNameForWorkspace('12345')
      expect(org).toBe('ws-12345')
    })

    it('sanitizes special characters for Gitea org name constraints', () => {
      const org = orgNameForWorkspace('workspace/with:special@chars')
      expect(org).not.toMatch(/[/:@]/)
      expect(org).toMatch(/^ws-/) // must have the prefix
    })

    it('is deterministic — same input → same output', () => {
      expect(orgNameForWorkspace('abc')).toBe(orgNameForWorkspace('abc'))
    })

    it('handles empty/null gracefully', () => {
      expect(orgNameForWorkspace('')).toBe('')
    })
  })

  describe('repoNameForSlug (pure)', () => {
    it('produces a sanitized repo name from a company slug', () => {
      const repo = repoNameForSlug('my-company')
      expect(repo).toBe('my-company')
    })

    it('lowercases the slug', () => {
      expect(repoNameForSlug('My-Company')).toBe('my-company')
    })

    it('sanitizes special characters for Gitea repo name constraints', () => {
      const repo = repoNameForSlug('company/with:special@chars')
      expect(repo).not.toMatch(/[/:@]/)
    })

    it('is deterministic', () => {
      expect(repoNameForSlug('foo')).toBe(repoNameForSlug('foo'))
    })
  })

  describe('taskBranchName (pure, #356 GIT-3)', () => {
    it('produces a task branch name with prefix', () => {
      expect(taskBranchName('task-123')).toBe('task/task-123')
    })

    it('lowercases the taskId', () => {
      expect(taskBranchName('TASK-ABC')).toBe('task/task-abc')
    })

    it('sanitizes special characters', () => {
      const name = taskBranchName('task/with:special@chars')
      expect(name).toBe('task/task-with-special-chars')
    })

    it('preserves dots and underscores', () => {
      expect(taskBranchName('task_v1.2')).toBe('task/task_v1.2')
    })

    it('truncates long taskIds to 50 chars', () => {
      const longId = 'a'.repeat(100)
      const name = taskBranchName(longId)
      // 'task/' (5) + 50 = 55
      expect(name.length).toBeLessThanOrEqual(55)
    })

    it('returns empty string for empty input', () => {
      expect(taskBranchName('')).toBe('')
      expect(taskBranchName('   ')).toBe('')
    })

    it('is deterministic', () => {
      expect(taskBranchName('x')).toBe(taskBranchName('x'))
    })
  })

  // #373/#374 — read-existing-repo-content helpers (pure logic only; the
  // network shell (fetchRepoFiles) is unit-untestable here same as every other
  // network call in this file — configured() is always false in this test env,
  // so it's "implicitly proven by the network calls working on a live Gitea
  // host" per this file's own established convention).
  describe('filterFetchableBlobs (pure)', () => {
    it('keeps only type=blob entries, drops trees (directories)', () => {
      const tree = [
        { path: 'src', type: 'tree' as const, sha: 'a' },
        { path: 'src/index.ts', type: 'blob' as const, sha: 'b' },
      ]
      const result = filterFetchableBlobs(tree)
      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('src/index.ts')
    })

    it('drops blobs over MAX_FETCHABLE_FILE_BYTES', () => {
      const tree = [
        { path: 'small.ts', type: 'blob' as const, sha: 'a', size: 100 },
        { path: 'huge.bin', type: 'blob' as const, sha: 'b', size: MAX_FETCHABLE_FILE_BYTES + 1 },
      ]
      const result = filterFetchableBlobs(tree)
      expect(result.map((b) => b.path)).toEqual(['small.ts'])
    })

    it('keeps a blob exactly at the size ceiling', () => {
      const tree = [{ path: 'at-limit.ts', type: 'blob' as const, sha: 'a', size: MAX_FETCHABLE_FILE_BYTES }]
      expect(filterFetchableBlobs(tree)).toHaveLength(1)
    })

    it('keeps a blob with no size field (some Gitea responses omit it)', () => {
      const tree = [{ path: 'no-size.ts', type: 'blob' as const, sha: 'a' }]
      expect(filterFetchableBlobs(tree)).toHaveLength(1)
    })

    it('handles an empty tree', () => {
      expect(filterFetchableBlobs([])).toEqual([])
    })
  })

  describe('decodeGiteaContent (pure)', () => {
    it('decodes valid base64 content to UTF-8 text', () => {
      const encoded = Buffer.from('export const x = 1', 'utf-8').toString('base64')
      expect(decodeGiteaContent({ content: encoded, encoding: 'base64' })).toBe('export const x = 1')
    })

    it('returns null when encoding is not base64', () => {
      expect(decodeGiteaContent({ content: 'abc', encoding: 'utf-8' })).toBeNull()
    })

    it('returns null when content is missing', () => {
      expect(decodeGiteaContent({ encoding: 'base64' })).toBeNull()
    })

    it('returns null for null/undefined body — never throws', () => {
      expect(decodeGiteaContent(null)).toBeNull()
      expect(decodeGiteaContent(undefined)).toBeNull()
    })

    it('round-trips real multi-line source content correctly', () => {
      const source = 'function foo() {\n  return "bar"\n}\n'
      const encoded = Buffer.from(source, 'utf-8').toString('base64')
      expect(decodeGiteaContent({ content: encoded, encoding: 'base64' })).toBe(source)
    })
  })
})
