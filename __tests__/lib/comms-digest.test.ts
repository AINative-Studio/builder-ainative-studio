import { describe, it, expect } from 'vitest'
import { buildAgileDigest, buildPairProgrammingDigest } from '@/lib/build/comms-digest'
import type { GiteaCommit } from '@/lib/git/gitea-client'

/**
 * #743 — pure digest content builders. HONESTY RULE under test: no real
 * underlying data → an honest "no updates"/"no new activity" message, never
 * fabricated status or invented commits.
 */

describe('buildAgileDigest (#743)', () => {
  it('sends an honest "no updates to report" email when there is no daily report', () => {
    const digest = buildAgileDigest({ companyName: 'Acme', dailyReportContent: null, dailyReportCreatedAt: null })
    expect(digest.text).toContain('no updates to report')
    expect(digest.text).not.toContain('shipped') // never fabricate specific activity
    expect(digest.html).toContain('no updates to report')
  })

  it('grounds the email in the real daily report content when one exists', () => {
    const report = '## Executive Summary\nCody dispatched task t-123 overnight.\n\n## Key Findings\n- did the thing'
    const digest = buildAgileDigest({
      companyName: 'Acme',
      dailyReportContent: report,
      dailyReportCreatedAt: '2026-09-14T07:00:00Z',
    })
    expect(digest.text).toContain('Cody dispatched task t-123 overnight')
    expect(digest.html).toContain('Cody dispatched task t-123 overnight')
  })

  it('escapes HTML in the company name and report content', () => {
    const digest = buildAgileDigest({
      companyName: '<script>Acme</script>',
      dailyReportContent: '<img src=x onerror=alert(1)>',
      dailyReportCreatedAt: '2026-09-14T07:00:00Z',
    })
    expect(digest.html).not.toContain('<script>')
    expect(digest.html).not.toContain('<img src=x onerror')
  })

  it('falls back to a generic company reference when companyName is empty', () => {
    const digest = buildAgileDigest({ companyName: '', dailyReportContent: null, dailyReportCreatedAt: null })
    expect(digest.text).toContain('your company')
  })
})

describe('buildPairProgrammingDigest (#743)', () => {
  const sinceIso = '2026-09-13T00:00:00.000Z'

  function commit(sha: string, message: string, author = 'Cody'): GiteaCommit {
    return {
      sha,
      html_url: `https://git.ainative.studio/ws-1/acme/commit/${sha}`,
      commit: {
        message,
        author: { name: author, email: 'cody@ainative.studio', date: '2026-09-14T00:00:00Z' },
        committer: { name: author, email: 'cody@ainative.studio', date: '2026-09-14T00:00:00Z' },
      },
    }
  }

  it('sends an honest "no new activity" email when there are no commits', () => {
    const digest = buildPairProgrammingDigest({ companyName: 'Acme', commits: [], sinceIso })
    expect(digest.subject).toContain('no new activity')
    expect(digest.text).toContain('No new commits')
    expect(digest.text).not.toMatch(/shipped:\s*\n-/) // no invented commit list
  })

  it('lists real commits with sha + author when there is activity', () => {
    const commits = [commit('abcdef1', 'fix the login bug'), commit('1234567', 'add pricing page', 'Cody')]
    const digest = buildPairProgrammingDigest({ companyName: 'Acme', commits, sinceIso, repoUrl: 'https://git.ainative.studio/ws-1/acme' })
    expect(digest.subject).toContain('2 new commits')
    expect(digest.text).toContain('fix the login bug')
    expect(digest.text).toContain('abcdef1')
    expect(digest.text).toContain('add pricing page')
    expect(digest.text).toContain('https://git.ainative.studio/ws-1/acme')
    expect(digest.html).toContain('fix the login bug')
  })

  it('uses singular "commit" for exactly one commit', () => {
    const digest = buildPairProgrammingDigest({ companyName: 'Acme', commits: [commit('a1', 'one change')], sinceIso })
    expect(digest.subject).toContain('1 new commit ')
    expect(digest.subject).not.toContain('1 new commits')
  })

  it('takes only the first line of a multi-line commit message as the subject', () => {
    const digest = buildPairProgrammingDigest({
      companyName: 'Acme',
      commits: [commit('a1', 'fix bug\n\nLonger body explaining the fix in detail.')],
      sinceIso,
    })
    expect(digest.text).toContain('fix bug')
    expect(digest.text).not.toContain('Longer body explaining')
  })

  it('escapes HTML in commit messages and author names', () => {
    const digest = buildPairProgrammingDigest({
      companyName: 'Acme',
      commits: [commit('a1', '<script>alert(1)</script>', '<b>hacker</b>')],
      sinceIso,
    })
    expect(digest.html).not.toContain('<script>')
    expect(digest.html).not.toContain('<b>hacker</b>')
  })
})
