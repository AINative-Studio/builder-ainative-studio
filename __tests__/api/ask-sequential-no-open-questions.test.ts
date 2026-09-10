import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Real customer feedback (enterprise account, "dedux" project, 2026-09-09):
 * Cody responded to a concrete build ask with a full multi-part architecture
 * proposal (core data model + agent wiring + API endpoints + auth) covering
 * far more than what was asked, then ended with an open-ended "does this
 * direction feel right, or do you want me to adjust the agent roles, data
 * structure, or API shape?" — forcing another round-trip instead of
 * committing to and executing the next concrete step. Root cause (see
 * issue #582): once a company is deployed, /api/build/ask's text-only Cody
 * persona is the fallback for most conversational asks, and its prompt
 * previously had no discipline against dumping a menu of everything it could
 * build or ending on a vague question. These assert the fix.
 */

const h = vi.hoisted(() => ({
  getClaudeCompletion: vi.fn(),
  auth: vi.fn(async () => null),
  getPlanStatus: vi.fn(),
  resolveActivePlan: vi.fn(async () => ({ plan: '' })),
  loadChatWithFallback: vi.fn(async () => []),
  saveExchange: vi.fn(async () => {}),
  resolveApp: vi.fn(async () => null),
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
  return { json: async () => body } as any
}

function fakeClaude(answer: string) {
  const create = vi.fn(async (_args: { system: string; messages: Array<{ role: string; content: string }> }) => ({
    content: [{ type: 'text', text: answer }],
  }))
  return {
    client: { messages: { create } },
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5',
    create,
  }
}

describe('POST /api/build/ask — sequential building, no open-ended dumps (2026-09-09)', () => {
  beforeEach(() => {
    h.getClaudeCompletion.mockReset()
    h.auth.mockReset().mockResolvedValue(null)
    h.resolveActivePlan.mockReset().mockResolvedValue({ plan: '' })
    h.loadChatWithFallback.mockReset().mockResolvedValue([])
    h.saveExchange.mockReset().mockResolvedValue(undefined)
    h.resolveApp.mockReset().mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as any))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('instructs naming the single next backlog item, not a menu, unless explicitly asked for options', async () => {
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({ question: 'design and build backend as necessary', idea: 'an idea', companyName: 'Dedux', track: 'company' }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/SINGLE next concrete backlog item/i)
    expect(system).toMatch(/not a menu of everything on the backlog/i)
  })

  it('instructs addressing only what was asked, not a broader architecture dump', async () => {
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({ question: 'design and build backend as necessary', idea: 'an idea', companyName: 'Dedux', track: 'company' }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/SEQUENTIAL, NOT A DUMP/i)
    expect(system).toMatch(/do not enumerate every feature\/endpoint\/table you could possibly build/i)
  })

  it('forbids ending a reply with an open-ended question', async () => {
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({ question: 'design and build backend as necessary', idea: 'an idea', companyName: 'Dedux', track: 'company' }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/NEVER end a reply with an open-ended question/i)
    expect(system).toMatch(/ask ONE specific question with a concrete two-option or yes\/no choice/i)
  })
})
