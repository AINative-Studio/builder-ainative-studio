import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * GET /api/build/nightshift — real-repro regression test.
 *
 * Live bug (beacon, 2026-09): the route asked Claude to write a first-person
 * "what I evaluated / the recommended next move" summary with ZERO real task
 * content passed into the prompt (only lastStatus/lastTaskId/lastRunAt — no
 * title, no output). Claude had nothing to ground that in, and wrote an
 * honest refusal to fabricate specifics instead — which then rendered
 * verbatim on the Live dashboard as if it WERE the summary. The fix: the
 * prompt must only ask for what's actually known (status), never invented
 * specifics.
 */

const h = vi.hoisted(() => ({
  getLastRun: vi.fn(),
  getClaudeCompletion: vi.fn(),
}))

vi.mock('@/lib/build/loop-enrollment', () => ({ getLastRun: h.getLastRun }))
vi.mock('@/lib/build/claude-completion', () => ({ getClaudeCompletion: h.getClaudeCompletion }))

import { GET } from '@/app/api/build/nightshift/route'

function req(qs: string) {
  return { url: `https://builder.ainative.studio/api/build/nightshift?${qs}` } as any
}

function fakeClaude(text: string) {
  return {
    client: { messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text }] })) } },
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5',
  }
}

describe('GET /api/build/nightshift', () => {
  beforeEach(() => {
    h.getLastRun.mockReset()
    h.getClaudeCompletion.mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  it('returns hasRun:false with no fabricated summary when no real run exists', async () => {
    h.getLastRun.mockResolvedValue(null)
    const res = await GET(req('companyId=beacon'))
    const data = await res.json()
    expect(data.hasRun).toBe(false)
    expect(data.summary).toBeUndefined()
    expect(h.getClaudeCompletion).not.toHaveBeenCalled()
  })

  it('never asks Claude to invent specifics it has no data for (prompt contains no "what you evaluated" style instruction)', async () => {
    h.getLastRun.mockResolvedValue({ lastRunAt: '2026-09-02T04:00:00Z', lastStatus: 'ok', lastTaskId: 't-1' })
    const claude = fakeClaude('Ran the nightly loop — status: ok.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await GET(req('companyId=beacon&companyName=Beacon&idea=a+crossposting+tool'))
    const callArgs = (claude.client.messages.create as any).mock.calls[0][0]
    const system = String(callArgs.system)
    expect(system).not.toMatch(/what you evaluated/i)
    expect(system).not.toMatch(/recommended next move/i)
    expect(system).toMatch(/do not invent|don't invent/i)
  })

  it('a real run with a successful Claude summary returns that summary verbatim', async () => {
    h.getLastRun.mockResolvedValue({ lastRunAt: '2026-09-02T04:00:00Z', lastStatus: 'ok', lastTaskId: 't-1' })
    h.getClaudeCompletion.mockReturnValue(fakeClaude('Ran the nightly loop overnight — status: ok.'))
    const res = await GET(req('companyId=beacon&companyName=Beacon&idea=an+idea'))
    const data = await res.json()
    expect(data.hasRun).toBe(true)
    expect(data.summary).toBe('Ran the nightly loop overnight — status: ok.')
  })

  it('a Claude failure falls back to the honest generic status line, never an empty or garbled summary', async () => {
    h.getLastRun.mockResolvedValue({ lastRunAt: '2026-09-02T04:00:00Z', lastStatus: 'ok', lastTaskId: 't-1' })
    h.getClaudeCompletion.mockReturnValue(null)
    const res = await GET(req('companyId=beacon&companyName=Beacon&idea=an+idea'))
    const data = await res.json()
    expect(data.hasRun).toBe(true)
    expect(data.summary).toContain('Beacon')
    expect(data.summary.length).toBeGreaterThan(0)
  })

  it('a Claude API error is handled honestly — falls back, never throws', async () => {
    h.getLastRun.mockResolvedValue({ lastRunAt: '2026-09-02T04:00:00Z', lastStatus: 'ok', lastTaskId: 't-1' })
    h.getClaudeCompletion.mockReturnValue({
      client: { messages: { create: vi.fn().mockRejectedValue(new Error('rate limited')) } },
      provider: 'anthropic' as const,
      model: 'claude-sonnet-4-5',
      label: 'Claude Sonnet 4.5',
    })
    const res = await GET(req('companyId=beacon&companyName=Beacon&idea=an+idea'))
    const data = await res.json()
    expect(data.hasRun).toBe(true)
    expect(typeof data.summary).toBe('string')
    expect(data.summary.length).toBeGreaterThan(0)
  })

  it('an empty companyId never calls getLastRun and returns hasRun:false', async () => {
    const res = await GET(req(''))
    const data = await res.json()
    expect(data.hasRun).toBe(false)
    expect(h.getLastRun).not.toHaveBeenCalled()
  })
})
