import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1607 — /api/cron/trial-engagement. Verifies:
 *  - CRON_SECRET gate (401 without it, same pattern as /api/cron/comms-digest);
 *  - dry-run by default, real send only with ?send=true;
 *  - audience = listRenewedTrialProjectIds() ∩ active companies with a real
 *    ownerEmail — NOT the loop-enrollment audience comms-digest uses;
 *  - commsOptOut and emailUndeliverableAt are honored, exactly like
 *    comms-digest;
 *  - a company with genuinely zero new activity STILL gets sent an email
 *    (the confirmed honesty rule — never silently skipped on zero activity);
 *  - lastTrialEngagementEmailAt is advanced ONLY after a confirmed send, and
 *    is a field distinct from comms-digest's own lastDigestAt;
 *  - one send call per company (a sweep, not a bulk blast).
 * All collaborators are mocked; no real network/email call is made.
 */

const h = vi.hoisted(() => ({
  listRenewedTrialProjectIds: vi.fn<() => Promise<string[]>>(async () => []),
  listAllAppsWithStatus: vi.fn<() => Promise<{ apps: any[]; ok: boolean }>>(async () => ({ apps: [], ok: true })),
  resolveApp: vi.fn<(slug: string) => Promise<any>>(async () => null),
  resolveAppVerified: vi.fn<(slug: string) => Promise<{ entry: any; verified: boolean }>>(async (slug: string): Promise<{ entry: any; verified: boolean }> => ({
    entry: await h.resolveApp(slug),
    verified: true,
  })),
  setAppLastTrialEngagementEmailAt: vi.fn<(slug: string, at: string) => Promise<boolean>>(async () => true),
  computeTrialActivitySince: vi.fn<(projectId: string, sinceIso: string) => Promise<{ newSignups: number; newVisits: number }>>(
    async () => ({ newSignups: 0, newVisits: 0 }),
  ),
  sendViaResend: vi.fn<
    (from: string, to: string, subject: string, html: string, text: string) => Promise<{ ok: boolean; id?: string; reason?: string }>
  >(async () => ({ ok: true, id: 'email-1' })),
}))

vi.mock('@/lib/build/company-zerodb-credentials', () => ({
  listRenewedTrialProjectIds: h.listRenewedTrialProjectIds,
}))
vi.mock('@/lib/build/app-registry', () => ({
  listAllAppsWithStatus: h.listAllAppsWithStatus,
  resolveApp: h.resolveApp,
  resolveAppVerified: h.resolveAppVerified,
  setAppLastTrialEngagementEmailAt: h.setAppLastTrialEngagementEmailAt,
}))
vi.mock('@/lib/build/trial-engagement-email', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/trial-engagement-email')>('@/lib/build/trial-engagement-email')
  return {
    ...actual,
    computeTrialActivitySince: h.computeTrialActivitySince,
  }
})
vi.mock('@/lib/build/resend-client', () => ({ sendViaResend: h.sendViaResend }))

import { GET, runTrialEngagementSweep } from '@/app/api/cron/trial-engagement/route'

function req(url: string, headers: Record<string, string> = {}) {
  return {
    url,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? headers[k] ?? null },
  } as any
}

const COMPANY_A = {
  slug: 'acme', chatId: 'c1', ownerEmail: 'founder@x.com', name: 'Acme',
  zerodbProjectId: 'proj-acme', lifecycleStatus: 'active',
}
const COMPANY_B = {
  slug: 'beta', chatId: 'c2', ownerEmail: 'founder2@x.com', name: 'Beta',
  zerodbProjectId: 'proj-beta', lifecycleStatus: 'active',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'shh'
  h.listRenewedTrialProjectIds.mockResolvedValue([])
  h.listAllAppsWithStatus.mockResolvedValue({ apps: [], ok: true })
  h.resolveApp.mockResolvedValue(null)
  h.resolveAppVerified.mockImplementation(async (slug: string) => ({ entry: await h.resolveApp(slug), verified: true }))
  h.setAppLastTrialEngagementEmailAt.mockResolvedValue(true)
  h.computeTrialActivitySince.mockResolvedValue({ newSignups: 0, newVisits: 0 })
  h.sendViaResend.mockResolvedValue({ ok: true, id: 'email-1' })
})

describe('GET /api/cron/trial-engagement (#1607)', () => {
  it('401s without the correct Bearer secret', async () => {
    const res: any = await GET(req('https://builder.ainative.studio/api/cron/trial-engagement'))
    expect(res.status).toBe(401)
    expect(h.listRenewedTrialProjectIds).not.toHaveBeenCalled()
  })

  it('401s with the wrong secret', async () => {
    const res: any = await GET(req('https://builder.ainative.studio/api/cron/trial-engagement', { authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
  })

  it('is a DRY RUN by default — selects the real audience but sends nothing', async () => {
    h.listRenewedTrialProjectIds.mockResolvedValue(['proj-acme'])
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [COMPANY_A], ok: true })
    h.resolveApp.mockResolvedValue(COMPANY_A)

    const res: any = await GET(req('https://builder.ainative.studio/api/cron/trial-engagement', { authorization: 'Bearer shh' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.sent).toBe(0)
    expect(h.sendViaResend).not.toHaveBeenCalled()
  })

  it('a real run (?send=true) actually sends and records the send', async () => {
    h.listRenewedTrialProjectIds.mockResolvedValue(['proj-acme'])
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [COMPANY_A], ok: true })
    h.resolveApp.mockResolvedValue(COMPANY_A)

    const res: any = await GET(
      req('https://builder.ainative.studio/api/cron/trial-engagement?send=true', { authorization: 'Bearer shh' }),
    )
    const body = await res.json()
    expect(body.sent).toBe(1)
    expect(h.sendViaResend).toHaveBeenCalledTimes(1)
    expect(h.sendViaResend.mock.calls[0][1]).toBe('founder@x.com')
    expect(h.setAppLastTrialEngagementEmailAt).toHaveBeenCalledWith('acme', expect.any(String))
  })

  it('audience is ONLY listRenewedTrialProjectIds — a company NOT in that list is never emailed even if otherwise eligible', async () => {
    h.listRenewedTrialProjectIds.mockResolvedValue([]) // acme not renewed-trial
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [COMPANY_A], ok: true })
    h.resolveApp.mockResolvedValue(COMPANY_A)

    const res: any = await GET(
      req('https://builder.ainative.studio/api/cron/trial-engagement?send=true', { authorization: 'Bearer shh' }),
    )
    const body = await res.json()
    expect(body.total).toBe(0)
    expect(h.sendViaResend).not.toHaveBeenCalled()
  })

  it('skips a deleted company honestly, never emails it', async () => {
    const deleted = { ...COMPANY_A, lifecycleStatus: 'deleted' }
    h.listRenewedTrialProjectIds.mockResolvedValue(['proj-acme'])
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [deleted], ok: true })
    h.resolveApp.mockResolvedValue(deleted)

    const res: any = await GET(
      req('https://builder.ainative.studio/api/cron/trial-engagement?send=true', { authorization: 'Bearer shh' }),
    )
    const body = await res.json()
    expect(body.total).toBe(0)
    expect(h.sendViaResend).not.toHaveBeenCalled()
  })

  it('skips a company with no ownerEmail honestly, never emails it', async () => {
    const noOwner = { ...COMPANY_A, ownerEmail: undefined }
    h.listRenewedTrialProjectIds.mockResolvedValue(['proj-acme'])
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [noOwner], ok: true })

    const res: any = await GET(
      req('https://builder.ainative.studio/api/cron/trial-engagement?send=true', { authorization: 'Bearer shh' }),
    )
    const body = await res.json()
    expect(body.total).toBe(0)
    expect(h.sendViaResend).not.toHaveBeenCalled()
  })

  it('(#840) honors a verified emailUndeliverableAt flag — skips, never sends', async () => {
    const bounced = { ...COMPANY_A, emailUndeliverableAt: '2026-10-01T00:00:00Z' }
    h.listRenewedTrialProjectIds.mockResolvedValue(['proj-acme'])
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [bounced], ok: true })
    h.resolveApp.mockResolvedValue(bounced)

    const res: any = await GET(
      req('https://builder.ainative.studio/api/cron/trial-engagement?send=true', { authorization: 'Bearer shh' }),
    )
    const body = await res.json()
    expect(body.results[0]).toMatchObject({ companyId: 'acme', sent: false, reason: 'recipient_undeliverable' })
    expect(h.sendViaResend).not.toHaveBeenCalled()
  })

  it('honors commsOptOut — skips, never sends', async () => {
    const optedOut = { ...COMPANY_A, commsOptOut: true }
    h.listRenewedTrialProjectIds.mockResolvedValue(['proj-acme'])
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [optedOut], ok: true })
    h.resolveApp.mockResolvedValue(optedOut)

    const res: any = await GET(
      req('https://builder.ainative.studio/api/cron/trial-engagement?send=true', { authorization: 'Bearer shh' }),
    )
    const body = await res.json()
    expect(body.results[0]).toMatchObject({ companyId: 'acme', sent: false, reason: 'comms_opted_out' })
    expect(h.sendViaResend).not.toHaveBeenCalled()
  })

  it('HONESTY RULE (#1607): a company with ZERO new activity still gets sent an email, never silently skipped', async () => {
    h.listRenewedTrialProjectIds.mockResolvedValue(['proj-acme'])
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [COMPANY_A], ok: true })
    h.resolveApp.mockResolvedValue(COMPANY_A)
    h.computeTrialActivitySince.mockResolvedValue({ newSignups: 0, newVisits: 0 })

    const res: any = await GET(
      req('https://builder.ainative.studio/api/cron/trial-engagement?send=true', { authorization: 'Bearer shh' }),
    )
    const body = await res.json()
    expect(body.sent).toBe(1)
    expect(h.sendViaResend).toHaveBeenCalledTimes(1)
  })

  it('lastTrialEngagementEmailAt is advanced ONLY after a confirmed successful send, never on failure', async () => {
    h.listRenewedTrialProjectIds.mockResolvedValue(['proj-acme'])
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [COMPANY_A], ok: true })
    h.resolveApp.mockResolvedValue(COMPANY_A)
    h.sendViaResend.mockResolvedValue({ ok: false, reason: 'resend_down' })

    const res: any = await GET(
      req('https://builder.ainative.studio/api/cron/trial-engagement?send=true', { authorization: 'Bearer shh' }),
    )
    const body = await res.json()
    expect(body.failed).toBe(1)
    expect(h.setAppLastTrialEngagementEmailAt).not.toHaveBeenCalled()
  })

  it('uses the correct per-company projectId and prior lastTrialEngagementEmailAt for the activity window', async () => {
    const withPriorSend = { ...COMPANY_A, lastTrialEngagementEmailAt: '2026-10-27T00:00:00Z' }
    h.listRenewedTrialProjectIds.mockResolvedValue(['proj-acme'])
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [withPriorSend], ok: true })
    h.resolveApp.mockResolvedValue(withPriorSend)

    await GET(req('https://builder.ainative.studio/api/cron/trial-engagement?send=true', { authorization: 'Bearer shh' }))
    expect(h.computeTrialActivitySince).toHaveBeenCalledWith('proj-acme', '2026-10-27T00:00:00Z')
  })

  it('multiple eligible companies each get exactly one send call (a sweep, not a bulk blast)', async () => {
    h.listRenewedTrialProjectIds.mockResolvedValue(['proj-acme', 'proj-beta'])
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [COMPANY_A, COMPANY_B], ok: true })
    h.resolveApp.mockImplementation(async (slug: string) => (slug === 'acme' ? COMPANY_A : COMPANY_B))

    const res: any = await GET(
      req('https://builder.ainative.studio/api/cron/trial-engagement?send=true', { authorization: 'Bearer shh' }),
    )
    const body = await res.json()
    expect(body.sent).toBe(2)
    expect(h.sendViaResend).toHaveBeenCalledTimes(2)
  })

  it('an unverified registry read never fabricates "zero companies" as success — reports 0 honestly without crashing', async () => {
    h.listAllAppsWithStatus.mockResolvedValue({ apps: [], ok: false })
    h.listRenewedTrialProjectIds.mockResolvedValue(['proj-acme'])

    const res: any = await GET(
      req('https://builder.ainative.studio/api/cron/trial-engagement?send=true', { authorization: 'Bearer shh' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(0)
    expect(h.sendViaResend).not.toHaveBeenCalled()
  })
})

describe('runTrialEngagementSweep — direct invocation', () => {
  it('exports dryRun/total/sent/skipped/failed/results exactly like comms-digest\'s shape', async () => {
    const result = await runTrialEngagementSweep({ dryRun: true })
    expect(result).toMatchObject({ ok: true, dryRun: true, total: 0, sent: 0, skipped: 0, failed: 0, results: [] })
  })
})
