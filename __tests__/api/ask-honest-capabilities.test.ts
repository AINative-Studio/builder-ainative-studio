import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * POST /api/build/ask — real bug repro (2026-09): a founder asked "How about
 * the logo, can you update that on the landing page?" and Cody answered with
 * a fully fabricated workflow — "go into the workspace, edit the landing page
 * component, swap out the logo image URL or upload a new one, and hit
 * regenerate" — none of which existed at the time. The system prompt had zero
 * grounding in real editing capabilities, so the model invented a
 * plausible-sounding but false answer.
 *
 * #492 shipped the real logo upload this manifest originally had to deny —
 * "Logo & brand" in the Website & app section now lets a founder upload their
 * own logo/brand mark, saved to their company. It still has a real, honest
 * limit: an uploaded logo is not yet automatically pushed into an
 * already-deployed company's live generated site. The manifest was updated to
 * describe the real capability AND its real limit, rather than denying the
 * capability now exists. These tests assert the prompt Claude actually
 * receives reflects that (accurate, not fabricated) capability + limit, and
 * still forbids fabricating a workaround for anything genuinely unwired.
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

describe('POST /api/build/ask — honest capability grounding', () => {
  beforeEach(() => {
    h.getClaudeCompletion.mockReset()
    h.auth.mockReset().mockResolvedValue(null)
    h.resolveActivePlan.mockReset().mockResolvedValue({ plan: '' })
    h.loadChatWithFallback.mockReset().mockResolvedValue([])
    h.saveExchange.mockReset().mockResolvedValue(undefined)
    h.resolveApp.mockReset().mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as any)) // backlog fetch — not under test
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('the system prompt tells Cody there is no in-chat file upload', async () => {
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({ question: 'Can you update the logo?', idea: 'a social crossposting tool', companyName: 'Beacon', track: 'company' }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/no in-chat file upload/i)
  })

  it('the system prompt tells Cody a real logo upload exists (#492)', async () => {
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({ question: 'Can you update the logo?', idea: 'an idea', companyName: 'Beacon', track: 'company' }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/real logo upload/i)
    expect(system).toMatch(/logo & brand/i)
  })

  it('the system prompt is honest that an uploaded logo is not yet wired into an already-deployed live site', async () => {
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({ question: 'Can you update the logo?', idea: 'an idea', companyName: 'Beacon', track: 'company' }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/not yet automatically pushed into/i)
    expect(system).toMatch(/do not claim the live site updates automatically/i)
  })

  it('the system prompt clarifies Auto Media uploads are NOT wired into the live app', async () => {
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({ question: 'Can you update the logo?', idea: 'an idea', companyName: 'Beacon', track: 'company' }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/not currently wired into the generated app/i)
  })

  it('the system prompt clarifies Redeploy re-ships the current version, not a regenerate action', async () => {
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({ question: 'Can you update the logo?', idea: 'an idea', companyName: 'Beacon', track: 'company' }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/redeploy.*re-ships the current stored version/i)
  })

  it('the system prompt explicitly instructs Cody never to fabricate a workaround workflow', async () => {
    const claude = fakeClaude('Honest answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({ question: 'Can you update the logo?', idea: 'an idea', companyName: 'Beacon', track: 'company' }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).toMatch(/never fabricate a plausible-sounding set of/i)
  })

  it('still answers the founder question normally when Claude responds honestly', async () => {
    const claude = fakeClaude('I can\'t change the logo from here yet — there\'s no editor wired up for that. I\'ll flag it as backlog.')
    h.getClaudeCompletion.mockReturnValue(claude)
    const res = await POST(req({ question: 'Can you update the logo?', idea: 'an idea', companyName: 'Beacon', track: 'company' }))
    const data = await res.json()
    expect(data.answer).toContain('backlog')
  })
})
