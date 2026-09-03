import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * POST /api/build/name-available — #479, the founder's manual-rename advisory
 * check. Deliberately advisory-only: unlike #478 (which prevents the LLM from
 * ever proposing a taken name), this route never blocks — it just tells the
 * caller whether the typed name collides with a DIFFERENT company so the
 * founder can make an informed choice.
 */

const h = vi.hoisted(() => ({ resolveApp: vi.fn() }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))

import { POST } from '@/app/api/build/name-available/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

describe('POST /api/build/name-available', () => {
  beforeEach(() => h.resolveApp.mockReset())
  afterEach(() => vi.restoreAllMocks())

  it('an available name (no registry match) returns available:true', async () => {
    h.resolveApp.mockResolvedValue(null)
    const res = await POST(req({ name: 'Brand New Co', chatId: 'chat-1' }))
    const data = await res.json()
    expect(data.available).toBe(true)
  })

  it('a name taken by a DIFFERENT chatId returns available:false with the existing name', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'dwello', chatId: 'someone-elses-chat', name: 'Dwello' })
    const res = await POST(req({ name: 'Dwello', chatId: 'chat-1' }))
    const data = await res.json()
    expect(data.available).toBe(false)
    expect(data.existingName).toBe('Dwello')
    expect(data.slug).toBe('dwello')
  })

  it('a registry hit on the SAME chatId (the company editing its own name) returns available:true', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme' })
    const res = await POST(req({ name: 'Acme', chatId: 'chat-1' }))
    const data = await res.json()
    expect(data.available).toBe(true)
  })

  it('reverting to the same name after editing away and back never false-warns', async () => {
    // Same scenario as above, explicit "edit then revert" framing per the
    // issue's own edge case wording.
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme' })
    const res = await POST(req({ name: '  Acme  '.trim(), chatId: 'chat-1' }))
    expect((await res.json()).available).toBe(true)
  })

  it('an empty name returns available:true without ever calling the registry', async () => {
    const res = await POST(req({ name: '   ', chatId: 'chat-1' }))
    const data = await res.json()
    expect(data.available).toBe(true)
    expect(h.resolveApp).not.toHaveBeenCalled()
  })

  it('a missing chatId still detects a collision against any existing registration', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'dwello', chatId: 'some-chat', name: 'Dwello' })
    const res = await POST(req({ name: 'Dwello' }))
    const data = await res.json()
    expect(data.available).toBe(false)
  })

  it('a registry lookup error fails open — available:true, never blocks the rename', async () => {
    h.resolveApp.mockRejectedValue(new Error('ZeroDB timeout'))
    const res = await POST(req({ name: 'Dwello', chatId: 'chat-1' }))
    const data = await res.json()
    expect(data.available).toBe(true)
  })

  it('malformed JSON body fails open — available:true, never throws', async () => {
    const res = await POST({ json: async () => { throw new Error('bad json') } } as any)
    const data = await res.json()
    expect(data.available).toBe(true)
  })

  it('derives the same slug shape /api/build/brand would (lowercase, hyphenated)', async () => {
    h.resolveApp.mockResolvedValue(null)
    const res = await POST(req({ name: 'Dwello Two!!', chatId: 'chat-1' }))
    const data = await res.json()
    expect(data.slug).toBe('dwello-two')
  })
})
