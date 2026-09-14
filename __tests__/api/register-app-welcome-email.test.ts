import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Welcome email from Cody at first registration (#758). Fires exactly once —
 * on a genuinely FIRST registration (`!existing`) with a real recipient
 * (`ownerEmail`) — and is deliberately skipped on a regeneration of an
 * already-registered company, or when there's no owner email to send to.
 *
 * Mirrors register-app-auto-enroll.test.ts's mock setup exactly, since both
 * suites cover sibling fire-and-forget branches in the same route.
 */

const h = vi.hoisted(() => ({
  registerApp: vi.fn(),
  resolveApp: vi.fn(),
  deployPersistent: vi.fn(),
  checkAppReady: vi.fn(),
  resolveStoredApp: vi.fn(),
  checkSeededData: vi.fn(),
  commitRegeneration: vi.fn(),
  provisionCompanyRepo: vi.fn(),
  enrollCompany: vi.fn(),
  isEnrolled: vi.fn(),
  auth: vi.fn(),
  sendWelcomeEmail: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({ registerApp: h.registerApp, resolveApp: h.resolveApp }))
vi.mock('@/lib/build/deploy', () => ({ deployPersistent: h.deployPersistent }))
vi.mock('@/lib/build/ready-gate', () => ({ checkAppReady: h.checkAppReady, resolveStoredApp: h.resolveStoredApp }))
vi.mock('@/lib/build/seed-check', () => ({ checkSeededData: h.checkSeededData }))
vi.mock('@/lib/git/company-repo', () => ({
  commitRegeneration: h.commitRegeneration,
  provisionCompanyRepo: h.provisionCompanyRepo,
}))
vi.mock('@/lib/build/instant-db', () => ({ BUILDER_WORKSPACE_ID: 'builder-ws-default' }))
vi.mock('@/lib/build/loop-enrollment', () => ({ enrollCompany: h.enrollCompany, isEnrolled: h.isEnrolled }))
vi.mock('@/lib/build/company-email', () => ({ sendWelcomeEmail: h.sendWelcomeEmail }))

import { POST } from '@/app/api/build/register-app/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('POST /api/build/register-app — welcome email (#758)', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    h.checkAppReady.mockResolvedValue({ checked: true, ok: true })
    h.deployPersistent.mockResolvedValue({ url: 'https://builder.ainative.studio/build/acme', dnsPointable: false })
    h.resolveApp.mockResolvedValue(null)
    h.resolveStoredApp.mockResolvedValue(null)
    h.registerApp.mockResolvedValue(true)
    h.auth.mockResolvedValue(null)
    h.enrollCompany.mockResolvedValue(true)
    h.isEnrolled.mockResolvedValue(false)
    h.sendWelcomeEmail.mockResolvedValue({ ok: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the welcome email on a brand-new, signed-in registration', async () => {
    h.auth.mockResolvedValue({ user: { email: 'Founder@Acme.com' } })
    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    expect(res.status).toBe(200)
    await flush()
    expect(h.sendWelcomeEmail).toHaveBeenCalledWith('Acme', 'founder@acme.com', 'acme')
  })

  it('does NOT send a welcome email on a regeneration (existing entry present)', async () => {
    // SAME chatId as the request → a real regeneration of the founder's own
    // existing build, so `existing` resolves non-null.
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-2', name: 'Acme', track: 'app', ownerEmail: 'founder@acme.com' })
    h.auth.mockResolvedValue({ user: { email: 'founder@acme.com' } })
    await POST(req({ slug: 'acme', chatId: 'chat-2', name: 'Acme', track: 'app' }))
    await flush()
    expect(h.sendWelcomeEmail).not.toHaveBeenCalled()
  })

  it('does NOT send a welcome email when there is no owner email (anonymous registration)', async () => {
    h.auth.mockResolvedValue(null)
    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()
    expect(h.sendWelcomeEmail).not.toHaveBeenCalled()
  })

  it('does NOT send a welcome email when registerApp itself fails', async () => {
    h.registerApp.mockResolvedValue(false)
    h.auth.mockResolvedValue({ user: { email: 'founder@acme.com' } })
    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()
    expect(h.sendWelcomeEmail).not.toHaveBeenCalled()
  })

  it('never fails registration when sendWelcomeEmail rejects', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@acme.com' } })
    h.sendWelcomeEmail.mockRejectedValue(new Error('resend down'))
    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('never fails registration when sendWelcomeEmail resolves { ok: false }', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@acme.com' } })
    h.sendWelcomeEmail.mockResolvedValue({ ok: false, reason: 'send_failed' })
    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('sends exactly once even when both auto-enroll and welcome-email branches fire on the same first registration', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@acme.com' } })
    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()
    expect(h.sendWelcomeEmail).toHaveBeenCalledTimes(1)
    expect(h.enrollCompany).toHaveBeenCalledTimes(1)
  })

  it('falls back to the slug as companyName when no name is given', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@acme.com' } })
    await POST(req({ slug: 'acme', chatId: 'chat-1', track: 'app' }))
    await flush()
    expect(h.sendWelcomeEmail).toHaveBeenCalledWith('acme', 'founder@acme.com', 'acme')
  })
})
