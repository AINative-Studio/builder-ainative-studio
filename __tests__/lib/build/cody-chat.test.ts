import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ create: vi.fn(), getClaudeCompletion: vi.fn() }))
vi.mock('@/lib/build/claude-completion', () => ({ getClaudeCompletion: h.getClaudeCompletion }))

describe('summarizeArtifactStep (#BLD-06.2)', () => {
  beforeEach(() => {
    h.create.mockReset()
    h.getClaudeCompletion.mockReset().mockReturnValue({
      client: { messages: { create: h.create } }, provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', label: 'Anthropic',
    })
  })

  it('returns a real summary from the completion client', async () => {
    h.create.mockResolvedValue({ content: [{ type: 'text', text: 'This is your venture thesis. It names who you help and why. Cody drafted it from your idea.' }] })
    const { summarizeArtifactStep } = await import('@/lib/build/cody-chat')
    const result = await summarizeArtifactStep('thesis', 'company', { headline: 'x' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary).toContain('venture thesis')
      expect(h.create).toHaveBeenCalledTimes(1)
    }
  })

  it('returns ok:false when no provider is configured, never throws', async () => {
    h.getClaudeCompletion.mockReturnValue(null)
    const { summarizeArtifactStep } = await import('@/lib/build/cody-chat')
    const result = await summarizeArtifactStep('thesis', 'company', {})
    expect(result).toEqual({ ok: false, reason: 'not_configured' })
  })

  it('returns ok:false, never throws, when the completion call itself fails', async () => {
    h.create.mockRejectedValue(new Error('provider 500'))
    const { summarizeArtifactStep } = await import('@/lib/build/cody-chat')
    const result = await summarizeArtifactStep('thesis', 'company', {})
    expect(result.ok).toBe(false)
  })
})
