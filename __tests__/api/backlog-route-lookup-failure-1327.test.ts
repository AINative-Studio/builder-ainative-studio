import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #832-class bug (#1327), the founder-facing half of the issue (higher
 * severity than versions/route.ts's #1330 fix per #1327's own triage):
 * backlog/route.ts resolved the company with the plain resolveApp(), whose
 * null return collapses "no registry entry yet" with "the registry read
 * itself failed". On a transient hiccup, hasPlan/hasDomain silently became
 * `false`, which flipped every queued item's blockedBy to 'subscription'
 * and made `gate` confidently pitch a plan to a real, already-paying,
 * provisioned founder — Cody would then cite that false pitch verbatim
 * (app/api/build/ask/route.ts's fetchBacklogSummary includes `gate` in its
 * prompt grounding for an unpaid-looking founder).
 *
 * Needed real design thought per #1327's own filing, since hasPlan/hasDomain
 * are plain booleans with no room for a third "couldn't check" state: adds
 * a top-level `verified` flag and, on verified:false, every queued item is
 * 'blocked'/'unverified' (never 'subscription' — a real payer must never be
 * told to pay again) and `gate` honestly says "couldn't check" instead of
 * either the sales pitch or the "actively queued" claim.
 *
 * @vitest-environment node
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveAppVerified: vi.fn<(...args: any[]) => Promise<{ entry: any; verified: boolean }>>(),
  createTask: vi.fn(),
  listTasks: vi.fn(),
  deriveOwnerKey: vi.fn(() => 'owner'),
  chatScopeKey: vi.fn(() => 'scope-key'),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({ resolveAppVerified: h.resolveAppVerified }))
vi.mock('@/lib/build/task-store', () => ({
  createTask: h.createTask,
  listTasks: h.listTasks,
}))
vi.mock('@/lib/build/chat-store', () => ({
  deriveOwnerKey: h.deriveOwnerKey,
  chatScopeKey: h.chatScopeKey,
}))

import { GET } from '@/app/api/build/backlog/route'

function req(url: string) {
  return { url } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.createTask.mockResolvedValue(null)
  h.listTasks.mockResolvedValue([])
})

const BASE_URL = 'http://localhost/api/build/backlog?idea=a+crm&companyName=Acme&companyId=acme'

describe('GET /api/build/backlog — honest behavior on an UNVERIFIED registry lookup (#1327)', () => {
  it('surfaces verified:false in the response', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })

    const res: any = await GET(req(BASE_URL))
    const json = await res.json()

    expect(json.verified).toBe(false)
  })

  it('never claims blockedBy: "subscription" for a lookup that genuinely could not be checked', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })

    const res: any = await GET(req(BASE_URL))
    const json = await res.json()

    for (const item of json.queued) {
      expect(item.blockedBy).not.toBe('subscription')
      expect(item.status).toBe('blocked')
      expect(item.blockedBy).toBe('unverified')
    }
  })

  it('never fabricates the sales-pitch gate message on an unverified lookup', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })

    const res: any = await GET(req(BASE_URL))
    const json = await res.json()

    expect(json.gate).toMatch(/couldn't confirm/i)
    expect(json.gate).not.toMatch(/What a plan adds/)
    expect(json.gate).not.toMatch(/actively queued/)
  })

  it('creates no real tasks on an unverified lookup (same as any other blocked state)', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    h.auth.mockResolvedValue({ user: { email: 'founder@example.com' } })

    await GET(req(BASE_URL))

    expect(h.createTask).not.toHaveBeenCalled()
  })
})

describe('GET /api/build/backlog — unaffected behavior on a CONFIRMED (verified:true) lookup', () => {
  it('a real paid+domained company still gets the real "actively queued" gate and queued status', async () => {
    h.resolveAppVerified.mockResolvedValue({
      entry: { zerodbProjectId: 'proj_1', domain: 'acme.com', plan: 'launch' },
      verified: true,
    })

    const res: any = await GET(req(BASE_URL))
    const json = await res.json()

    expect(json.verified).toBe(true)
    expect(json.gate).toMatch(/actively queued/)
    for (const item of json.queued) {
      expect(item.status).toBe('queued')
      expect(item.blockedBy).toBeUndefined()
    }
  })

  it('a confirmed free/unpaid company still gets the real sales-pitch gate', async () => {
    h.resolveAppVerified.mockResolvedValue({
      entry: { zerodbProjectId: 'proj_1', domain: null, plan: null },
      verified: true,
    })

    const res: any = await GET(req(BASE_URL))
    const json = await res.json()

    expect(json.verified).toBe(true)
    expect(json.gate).toMatch(/What a plan adds/)
    for (const item of json.queued) {
      expect(item.blockedBy).toBe('subscription')
    }
  })
})
