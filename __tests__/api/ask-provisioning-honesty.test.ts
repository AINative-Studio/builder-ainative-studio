import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * POST /api/build/ask — issue #748: real, direct user report. An admin
 * created a company ("Clearpath") that got a live, reachable dashboard but
 * was NEVER actually provisioned — no owner, no ZeroDB project, no
 * primitives, no auth. Cody's own chat responses claimed "the data layer is
 * fully functional," "ZeroMemory is handling context," and "next up in the
 * queue is authentication" — none of which had happened. When asked directly
 * whether git provisioning had run, Cody said "I don't have a way to check
 * your git provisioning status from this chat" — FALSE: `resolveApp(companyId)`
 * already had the full registry entry (gitOrg/zerodbProjectId/plan) in scope,
 * it was simply never threaded into the system prompt for that question
 * shape (resolveApp was only ever called inside the edit-intent branch).
 *
 * These tests mock resolveApp to return an entry with NO zerodbProjectId
 * (mirroring the real Clearpath row) and assert the system prompt Claude
 * receives (a) is always given the real provisioning state regardless of
 * question shape, (b) explicitly forbids "I don't have a way to check", and
 * (c) explicitly forbids claiming data layer/ZeroMemory/auth/primitives are
 * live when they are not. A companion case asserts the OPPOSITE instruction
 * appears when the company IS provisioned.
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

describe('POST /api/build/ask — honest provisioning-status grounding (#748)', () => {
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

  it('resolves resolveApp(companyId) even for a plain status question with no edit intent', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'clearpath', chatId: 'abc123' }) // no zerodbProjectId — matches the real Clearpath row
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({
      question: 'Has git provisioning run for my company yet?',
      idea: 'a logistics platform', companyName: 'Clearpath', track: 'company', companyId: 'clearpath',
    }))
    expect(h.resolveApp).toHaveBeenCalledWith('clearpath')
  })

  it('an unprovisioned company (no zerodbProjectId) gets an explicit "not provisioned yet" instruction in the system prompt', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'clearpath', chatId: 'abc123', name: 'Clearpath' })
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({
      question: 'Is my data layer live?', idea: 'a logistics platform', companyName: 'Clearpath', track: 'company', companyId: 'clearpath',
    }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/has NOT been provisioned yet/i)
  })

  it('forbids the exact false "I don\'t have a way to check" claim when provisioning data IS in scope', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'clearpath', chatId: 'abc123' })
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({
      question: 'Can you check my git provisioning status?', idea: 'idea', companyName: 'Clearpath', track: 'company', companyId: 'clearpath',
    }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/NEVER say "I don't have a way to check"/i)
  })

  it('forbids claiming the data layer/ZeroMemory/auth are live/queued when unprovisioned', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'clearpath', chatId: 'abc123' })
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({
      question: 'What is live so far?', idea: 'idea', companyName: 'Clearpath', track: 'company', companyId: 'clearpath',
    }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/NEVER claim the data layer, ZeroMemory context, auth, or/i)
  })

  it('mentions auto-provisioning / the manual provision control as the honest next step for an unprovisioned company', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'clearpath', chatId: 'abc123' })
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({
      question: 'Why is nothing working?', idea: 'idea', companyName: 'Clearpath', track: 'company', companyId: 'clearpath',
    }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/automatically/i)
    expect(system).toMatch(/Provision cloud/i)
  })

  it('a PROVISIONED company gets the opposite instruction: confident, no "can\'t check" hedging', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'mendr', chatId: 'xyz789', zerodbProjectId: 'proj-real-123', gitOrg: 'org-1', plan: 'launch' })
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({
      question: 'Is my company provisioned?', idea: 'idea', companyName: 'Mendr', track: 'company', companyId: 'mendr',
    }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/this company IS provisioned/i)
    expect(system).not.toMatch(/has NOT been provisioned yet/i)
  })

  it('still answers the founder question normally when Claude responds honestly about an unprovisioned company', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'clearpath', chatId: 'abc123' })
    const claude = fakeClaude("Nothing's provisioned for Clearpath yet — no database, primitives, or auth are live. That's happening automatically now; I'll let you know the moment it's done.")
    h.getClaudeCompletion.mockReturnValue(claude)
    const res = await POST(req({
      question: 'Has git provisioning run?', idea: 'idea', companyName: 'Clearpath', track: 'company', companyId: 'clearpath',
    }))
    const data = await res.json()
    expect(data.answer).toMatch(/Nothing's provisioned/i)
  })

  it('resolveApp failure (rejected promise) degrades to the honest "not provisioned" framing rather than throwing', async () => {
    h.resolveApp.mockRejectedValue(new Error('zerodb down'))
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    const res = await POST(req({
      question: 'Is my company set up?', idea: 'idea', companyName: 'Clearpath', track: 'company', companyId: 'clearpath',
    }))
    expect(res.status).not.toBe(500)
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/has NOT been provisioned yet/i)
  })
})
