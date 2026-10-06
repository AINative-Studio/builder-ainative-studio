import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ create: vi.fn(), getClaudeCompletion: vi.fn() }))
vi.mock('@/lib/build/claude-completion', () => ({ getClaudeCompletion: h.getClaudeCompletion }))

describe('explainBeforeBuilding (#BLD-06.9)', () => {
  beforeEach(() => {
    h.create.mockReset()
    h.getClaudeCompletion.mockReset().mockReturnValue({ client: { messages: { create: h.create } }, provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', label: 'Anthropic' })
  })

  it('returns a real explanation naming the build and its business goal', async () => {
    h.create.mockResolvedValue({ content: [{ type: 'text', text: "I'm about to build your live preview — this tests whether real customers will sign up." }] })
    const { explainBeforeBuilding } = await import('@/lib/build/cody-chat')
    const result = await explainBeforeBuilding('preview', 'company', 'a scheduling app for tutors')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.explanation).toContain('build')
  })

  it('returns ok:false, never throws, on a provider gap', async () => {
    h.getClaudeCompletion.mockReturnValue(null)
    const { explainBeforeBuilding } = await import('@/lib/build/cody-chat')
    const result = await explainBeforeBuilding('preview', 'company', 'x')
    expect(result.ok).toBe(false)
  })
})
