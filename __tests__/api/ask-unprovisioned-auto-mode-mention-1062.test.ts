import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * POST /api/build/ask — #1062: real founder report. Asked Cody (company
 * "pathly", unprovisioned at the time) how to get the nightly autonomous
 * loop running against the real backend. Cody's reply named ONLY "Provision
 * cloud" — the real, correct first step (it sets up the per-company ZeroDB
 * project/auth/primitives), but never mentioned that starting the nightly
 * loop itself is a SEPARATE action (the "Auto Mode" button), or that Auto
 * Mode requires a paid plan (confirmed in lib/build/auto-mode.ts /
 * lib/build/state.ts's planUnlocks().nightlyLoop, Pro+).
 *
 * These tests assert the #748 provisioning-status block (still correct and
 * unchanged for general status questions) now ALSO surfaces Auto Mode as the
 * next real step when the company is unprovisioned, with the correct
 * paid/unpaid framing for the caller's actual plan.
 */

const h = vi.hoisted(() => ({
  getClaudeCompletion: vi.fn(),
  auth: vi.fn(async () => null),
  getPlanStatus: vi.fn(),
  resolveActivePlan: vi.fn(async () => ({ plan: '' })),
  loadChatWithFallback: vi.fn(async () => []),
  saveExchange: vi.fn(async () => true),
  resolveApp: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
}))

vi.mock('@/lib/build/claude-completion', () => ({ getClaudeCompletion: h.getClaudeCompletion }))
vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/ainative/plan', () => ({ getPlanStatus: h.getPlanStatus }))
vi.mock('@/lib/ainative/active-plan', () => ({ resolveActivePlan: h.resolveActivePlan }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/chat-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/chat-store')>('@/lib/build/chat-store')
  return {
    ...actual,
    loadChatWithFallback: h.loadChatWithFallback,
    saveExchange: h.saveExchange,
  }
})

import { POST } from '@/app/api/build/ask/route'

function req(body: unknown) {
  return { json: async () => body, url: 'https://builder.ainative.studio/api/build/ask' } as any
}

function fakeClaude(answer: string) {
  const create = vi.fn(async (_args: { system: string; messages: Array<{ role: string; content: string }> }) => ({
    content: [{ type: 'text', text: answer }],
  }))
  return { client: { messages: { create } }, provider: 'anthropic' as const, model: 'claude-sonnet-4-5', create }
}

describe('POST /api/build/ask — unprovisioned company gets the real Auto Mode step too (#1062)', () => {
  beforeEach(() => {
    h.getClaudeCompletion.mockReset()
    h.auth.mockReset().mockResolvedValue(null)
    h.resolveActivePlan.mockReset().mockResolvedValue({ plan: '' })
    h.loadChatWithFallback.mockReset().mockResolvedValue([])
    h.saveExchange.mockReset().mockResolvedValue(true)
    h.resolveApp.mockReset().mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as any)) // backlog fetch — not under test
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('mentions Auto Mode as the SEPARATE step for starting the nightly loop, not just Provision cloud', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'pathly', chatId: 'abc123', name: 'Pathly' }) // no zerodbProjectId
    h.resolveActivePlan.mockResolvedValue({ plan: '' }) // unpaid, matches the real report
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)

    await POST(req({
      question: 'How do I get the nightly autonomous loop running on my real backend?',
      idea: 'a logistics platform', companyName: 'Pathly', track: 'company', companyId: 'pathly',
    }))

    const system = String(claude.create.mock.calls[0][0].system)
    // Still names the real, correct first step.
    expect(system).toMatch(/Provision cloud/i)
    // AND now also names the real second step by its actual UI name.
    expect(system).toMatch(/Auto Mode/i)
    expect(system).toMatch(/SECOND, SEPARATE step/i)
  })

  it('tells Cody Auto Mode requires a paid plan when the caller is unpaid', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'pathly', chatId: 'abc123', name: 'Pathly' })
    h.resolveActivePlan.mockResolvedValue({ plan: '' }) // unpaid
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)

    await POST(req({
      question: 'What do I click to start the loop?', idea: 'idea', companyName: 'Pathly', track: 'company', companyId: 'pathly',
    }))

    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/Auto Mode requires a paid plan/i)
  })

  it('tells Cody the caller already has Auto Mode unlocked when their plan covers it', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'pathly', chatId: 'abc123', name: 'Pathly' })
    h.resolveActivePlan.mockResolvedValue({ plan: 'pro' }) // Pro+ unlocks nightlyLoop
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)

    await POST(req({
      question: 'What do I click to start the loop?', idea: 'idea', companyName: 'Pathly', track: 'company', companyId: 'pathly',
    }))

    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/plan already unlocks Auto Mode/i)
    expect(system).not.toMatch(/Auto Mode requires a paid plan/i)
  })

  it('a PROVISIONED company does not get the unprovisioned-specific Auto Mode framing (that branch is untouched)', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'mendr', chatId: 'xyz789', zerodbProjectId: 'proj-real-123', gitOrg: 'org-1', plan: 'launch' })
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)

    await POST(req({
      question: 'Is my company provisioned?', idea: 'idea', companyName: 'Mendr', track: 'company', companyId: 'mendr',
    }))

    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).not.toMatch(/SECOND, SEPARATE step/i)
  })
})
