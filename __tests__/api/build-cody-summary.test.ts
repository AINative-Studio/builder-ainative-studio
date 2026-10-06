/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ summarizeArtifactStep: vi.fn() }))
vi.mock('@/lib/build/cody-chat', () => ({ summarizeArtifactStep: h.summarizeArtifactStep }))

import { POST } from '@/app/api/build/cody-summary/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

describe('POST /api/build/cody-summary (#BLD-06.2)', () => {
  beforeEach(() => { h.summarizeArtifactStep.mockReset() })

  it('returns the real summary on success', async () => {
    h.summarizeArtifactStep.mockResolvedValue({ ok: true, summary: 'Plain summary.' })
    const res = await POST(req({ view: 'thesis', track: 'company', content: {} }))
    expect(res.status).toBe(200)
    expect((await res.json()).summary).toBe('Plain summary.')
  })

  it('returns 200 with ok:false on a provider gap, never a 500', async () => {
    h.summarizeArtifactStep.mockResolvedValue({ ok: false, reason: 'not_configured' })
    const res = await POST(req({ view: 'thesis', track: 'company', content: {} }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(false)
  })

  it('rejects a missing view', async () => {
    const res = await POST(req({ track: 'company', content: {} }))
    expect(res.status).toBe(400)
  })
})
