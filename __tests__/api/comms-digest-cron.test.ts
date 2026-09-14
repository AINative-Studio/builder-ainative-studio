import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #743 — /api/cron/comms-digest. Verifies:
 *  - CRON_SECRET gate (401 without it, same pattern as /api/cron/winback);
 *  - dry-run by default, real send only with ?send=true (same safety posture);
 *  - agile-mode branching pulls today's real 'daily' report and calls
 *    sendCompanyEmail with content grounded in it;
 *  - agile-mode with no report yet still sends an honest "no updates" email
 *    (never skips the founder entirely — every enrolled company gets SOME
 *    email by default);
 *  - pairProgramming-mode branching calls getCommitsSince with the company's
 *    lastDigestAt (or a 24h default) and updates lastDigestAt ONLY after a
 *    successful send;
 *  - a company with no gitOrg/gitRepoUrl yet is skipped honestly (no repo to
 *    summarize) rather than fabricating a digest;
 *  - a company with no registered owner email is skipped (nothing to send to);
 *  - one sendCompanyEmail call per company (a sweep, not a bulk blast).
 * All collaborators are mocked; no real network/email call is made.
 */

const h = vi.hoisted(() => ({
  listEnrolled: vi.fn<() => Promise<any[]>>(async () => []),
  resolveApp: vi.fn<(slug: string) => Promise<any>>(async () => null),
  setAppLastDigestAt: vi.fn<(slug: string, at: string) => Promise<boolean>>(async () => true),
  listDocuments: vi.fn<(scopeKey: string) => Promise<any[]>>(async () => []),
  getCommitsSince: vi.fn<(org: string, repo: string, sinceIso: string) => Promise<any[]>>(async () => []),
  sendCompanyEmail: vi.fn<
    (companyName: string, to: string, subject: string, html: string, text: string) =>
      Promise<{ ok: boolean; id?: string; reason?: string }>
  >(async () => ({ ok: true, id: 'email-1' })),
}))

vi.mock('@/lib/build/loop-enrollment', () => ({ listEnrolled: h.listEnrolled }))
vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  setAppLastDigestAt: h.setAppLastDigestAt,
}))
vi.mock('@/lib/build/document-store', () => ({ listDocuments: h.listDocuments }))
vi.mock('@/lib/git/gitea-client', () => ({ getCommitsSince: h.getCommitsSince }))
vi.mock('@/lib/build/company-email', () => ({ sendCompanyEmail: h.sendCompanyEmail }))

import { GET, runCommsDigestSweep } from '@/app/api/cron/comms-digest/route'

function req(url: string, headers: Record<string, string> = {}) {
  return {
    url,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? headers[k] ?? null },
  } as any
}

const ENROLLED_AGILE = {
  companyId: 'acme', companyName: 'Acme', track: 'company' as const,
  ownerKey: 'founder@x.com', enabled: true, enrolledAt: '2026-08-01T00:00:00Z',
}
const ENROLLED_PAIR = {
  companyId: 'beta', companyName: 'Beta', track: 'app' as const,
  ownerKey: 'founder2@x.com', enabled: true, enrolledAt: '2026-08-01T00:00:00Z',
}

const APP_AGILE = { slug: 'acme', chatId: 'c1', ownerEmail: 'founder@x.com', commsMode: 'agile', createdAt: '2026-08-01T00:00:00Z' }
const APP_PAIR = {
  slug: 'beta', chatId: 'c2', ownerEmail: 'founder2@x.com', commsMode: 'pairProgramming',
  gitOrg: 'ws-1', gitRepoUrl: 'https://git.ainative.studio/ws-1/beta', createdAt: '2026-08-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'shh'
  h.listEnrolled.mockResolvedValue([])
  h.resolveApp.mockResolvedValue(null)
  h.setAppLastDigestAt.mockResolvedValue(true)
  h.listDocuments.mockResolvedValue([])
  h.getCommitsSince.mockResolvedValue([])
  h.sendCompanyEmail.mockResolvedValue({ ok: true, id: 'email-1' })
})

describe('GET /api/cron/comms-digest (#743)', () => {
  it('401s without the correct Bearer secret', async () => {
    const res: any = await GET(req('https://builder.ainative.studio/api/cron/comms-digest'))
    expect(res.status).toBe(401)
    expect(h.listEnrolled).not.toHaveBeenCalled()
  })

  it('401s with the wrong secret', async () => {
    const res: any = await GET(req('https://builder.ainative.studio/api/cron/comms-digest', { authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
  })

  it('runs a dry-run sweep (no send param) — never calls sendCompanyEmail', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_AGILE])
    h.resolveApp.mockResolvedValue(APP_AGILE)
    const res: any = await GET(req('https://builder.ainative.studio/api/cron/comms-digest', { authorization: 'Bearer shh' }))
    const json = await res.json()
    expect(json.dryRun).toBe(true)
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
  })

  it('sends real emails when ?send=true', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_AGILE])
    h.resolveApp.mockResolvedValue(APP_AGILE)
    const res: any = await GET(req('https://builder.ainative.studio/api/cron/comms-digest?send=true', { authorization: 'Bearer shh' }))
    const json = await res.json()
    expect(json.dryRun).toBe(false)
    expect(h.sendCompanyEmail).toHaveBeenCalledTimes(1)
  })
})

describe('runCommsDigestSweep — agile mode (#743)', () => {
  it('sends an honest "no updates" email when no daily report exists yet for today', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_AGILE])
    h.resolveApp.mockResolvedValue(APP_AGILE)
    h.listDocuments.mockResolvedValue([])
    const result = await runCommsDigestSweep({ dryRun: false })
    expect(result.sent).toBe(1)
    const [companyName, to, , html, text] = h.sendCompanyEmail.mock.calls[0]
    expect(companyName).toBe('Acme')
    expect(to).toBe('founder@x.com')
    expect(text).toContain('no updates to report')
    expect(html).toContain('no updates to report')
  })

  it("grounds the email in today's real daily report content", async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_AGILE])
    h.resolveApp.mockResolvedValue(APP_AGILE)
    const today = new Date().toISOString()
    h.listDocuments.mockResolvedValue([
      { id: 'd1', type: 'daily', kind: 'report', title: 'Daily Report', content: 'Cody shipped a real fix overnight.', createdAt: today },
    ])
    await runCommsDigestSweep({ dryRun: false })
    const [, , , , text] = h.sendCompanyEmail.mock.calls[0]
    expect(text).toContain('Cody shipped a real fix overnight')
  })

  it('ignores a daily report from a PRIOR day (not today) — honest empty state', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_AGILE])
    h.resolveApp.mockResolvedValue(APP_AGILE)
    h.listDocuments.mockResolvedValue([
      { id: 'd1', type: 'daily', kind: 'report', title: 'Old', content: 'Yesterday activity', createdAt: '2020-01-01T07:00:00Z' },
    ])
    await runCommsDigestSweep({ dryRun: false })
    const [, , , , text] = h.sendCompanyEmail.mock.calls[0]
    expect(text).toContain('no updates to report')
    expect(text).not.toContain('Yesterday activity')
  })

  it('never advances lastDigestAt for agile mode', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_AGILE])
    h.resolveApp.mockResolvedValue(APP_AGILE)
    await runCommsDigestSweep({ dryRun: false })
    expect(h.setAppLastDigestAt).not.toHaveBeenCalled()
  })
})

describe('runCommsDigestSweep — pairProgramming mode (#743)', () => {
  it('calls getCommitsSince with the org/repo and the default lookback when lastDigestAt is absent', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_PAIR])
    h.resolveApp.mockResolvedValue(APP_PAIR)
    await runCommsDigestSweep({ dryRun: false })
    expect(h.getCommitsSince).toHaveBeenCalledWith('ws-1', 'beta', expect.any(String))
    const sinceArg = h.getCommitsSince.mock.calls[0][2]
    const ageMs = Date.now() - Date.parse(sinceArg)
    expect(ageMs).toBeGreaterThan(23 * 60 * 60 * 1000)
    expect(ageMs).toBeLessThan(25 * 60 * 60 * 1000)
  })

  it('uses the stored lastDigestAt as the delta start when present', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_PAIR])
    h.resolveApp.mockResolvedValue({ ...APP_PAIR, lastDigestAt: '2026-09-10T00:00:00.000Z' })
    await runCommsDigestSweep({ dryRun: false })
    expect(h.getCommitsSince).toHaveBeenCalledWith('ws-1', 'beta', '2026-09-10T00:00:00.000Z')
  })

  it('advances lastDigestAt ONLY after a successful send', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_PAIR])
    h.resolveApp.mockResolvedValue(APP_PAIR)
    h.getCommitsSince.mockResolvedValue([{ sha: 'a1', html_url: 'x', commit: { message: 'fix', author: { date: '2026-09-14T00:00:00Z' }, committer: {} } }])
    await runCommsDigestSweep({ dryRun: false })
    expect(h.setAppLastDigestAt).toHaveBeenCalledWith('beta', expect.any(String))
  })

  it('does NOT advance lastDigestAt when the send fails', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_PAIR])
    h.resolveApp.mockResolvedValue(APP_PAIR)
    h.sendCompanyEmail.mockResolvedValue({ ok: false, reason: 'send_failed' })
    await runCommsDigestSweep({ dryRun: false })
    expect(h.setAppLastDigestAt).not.toHaveBeenCalled()
  })

  it('does NOT call getCommitsSince or send in dry-run mode', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_PAIR])
    h.resolveApp.mockResolvedValue(APP_PAIR)
    await runCommsDigestSweep({ dryRun: true })
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
    expect(h.setAppLastDigestAt).not.toHaveBeenCalled()
  })

  it('skips a company with no gitOrg/gitRepoUrl yet — never fabricates a digest', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_PAIR])
    h.resolveApp.mockResolvedValue({ slug: 'beta', chatId: 'c2', ownerEmail: 'founder2@x.com', commsMode: 'pairProgramming', createdAt: '2026-08-01T00:00:00Z' })
    const result = await runCommsDigestSweep({ dryRun: false })
    expect(result.skipped).toBe(1)
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
    expect(h.getCommitsSince).not.toHaveBeenCalled()
  })
})

describe('runCommsDigestSweep — commsOptOut (#742 baseline policy adopted) (#743)', () => {
  it('skips a company that has opted out of proactive comms, before even checking owner email', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_AGILE])
    h.resolveApp.mockResolvedValue({ ...APP_AGILE, commsOptOut: true })
    const result = await runCommsDigestSweep({ dryRun: false })
    expect(result.skipped).toBe(1)
    expect(result.results[0].reason).toBe('comms_opted_out')
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
  })

  it('sends normally when commsOptOut is absent/false', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_AGILE])
    h.resolveApp.mockResolvedValue({ ...APP_AGILE, commsOptOut: false })
    const result = await runCommsDigestSweep({ dryRun: false })
    expect(result.sent).toBe(1)
  })
})

describe('runCommsDigestSweep — general behavior (#743)', () => {
  it('skips a company with no registered owner email', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_AGILE])
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'c1', createdAt: '2026-08-01T00:00:00Z' })
    const result = await runCommsDigestSweep({ dryRun: false })
    expect(result.skipped).toBe(1)
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
  })

  it('defaults to agile mode when commsMode is absent on the registry entry', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_AGILE])
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'c1', ownerEmail: 'founder@x.com', createdAt: '2026-08-01T00:00:00Z' })
    const result = await runCommsDigestSweep({ dryRun: false })
    expect(result.results[0].mode).toBe('agile')
    expect(h.getCommitsSince).not.toHaveBeenCalled()
  })

  it('sends exactly ONE email per enrolled company (a sweep, not a bulk blast)', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_AGILE, ENROLLED_PAIR])
    h.resolveApp.mockImplementation(async (slug: string) => (slug === 'acme' ? APP_AGILE : APP_PAIR))
    const result = await runCommsDigestSweep({ dryRun: false })
    expect(h.sendCompanyEmail).toHaveBeenCalledTimes(2)
    expect(result.sent).toBe(2)
  })

  it('a failure for one company does not block the others in the sweep', async () => {
    h.listEnrolled.mockResolvedValue([ENROLLED_AGILE, ENROLLED_PAIR])
    h.resolveApp.mockImplementation(async (slug: string) => (slug === 'acme' ? APP_AGILE : APP_PAIR))
    h.sendCompanyEmail
      .mockResolvedValueOnce({ ok: false, reason: 'resend_error' })
      .mockResolvedValueOnce({ ok: true, id: 'e2' })
    const result = await runCommsDigestSweep({ dryRun: false })
    expect(result.failed).toBe(1)
    expect(result.sent).toBe(1)
  })
})
