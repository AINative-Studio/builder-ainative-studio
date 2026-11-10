import { describe, it, expect } from 'vitest'
import { issueWebUrl } from '@/lib/git/gitea-client'

/**
 * issueWebUrl() (#1912) — PURE helper so the founder-facing tasks route can
 * link to the real Gitea issue #905 opens on a company's repo before
 * implementation begins. Previously this issue number was persisted but
 * never surfaced as a clickable link anywhere in Builder's own UI.
 */
describe('issueWebUrl', () => {
  it('derives the issue URL from a .git clone URL', () => {
    expect(issueWebUrl('https://git.example.test/ws-acme/acme.git', 42)).toBe(
      'https://git.example.test/ws-acme/acme/issues/42',
    )
  })

  it('works when gitRepoUrl has no trailing .git', () => {
    expect(issueWebUrl('https://git.example.test/ws-acme/acme', 7)).toBe(
      'https://git.example.test/ws-acme/acme/issues/7',
    )
  })

  it('strips a trailing slash before appending /issues/{n}', () => {
    expect(issueWebUrl('https://git.example.test/ws-acme/acme.git/', 7)).toBe(
      'https://git.example.test/ws-acme/acme/issues/7',
    )
  })

  it('returns null when gitRepoUrl is absent (company not git-provisioned yet)', () => {
    expect(issueWebUrl(undefined, 42)).toBeNull()
    expect(issueWebUrl(null, 42)).toBeNull()
    expect(issueWebUrl('', 42)).toBeNull()
  })

  it('returns null when the issue number is absent/invalid', () => {
    expect(issueWebUrl('https://git.example.test/ws-acme/acme.git', undefined)).toBeNull()
    expect(issueWebUrl('https://git.example.test/ws-acme/acme.git', null)).toBeNull()
    expect(issueWebUrl('https://git.example.test/ws-acme/acme.git', 0)).toBeNull()
    expect(issueWebUrl('https://git.example.test/ws-acme/acme.git', -3)).toBeNull()
    expect(issueWebUrl('https://git.example.test/ws-acme/acme.git', NaN)).toBeNull()
  })
})
