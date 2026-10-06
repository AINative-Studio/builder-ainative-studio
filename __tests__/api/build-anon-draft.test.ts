/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ saveAnonDraft: vi.fn(), loadAnonDraft: vi.fn() }))
vi.mock('@/lib/build/anon-drafts', () => ({ saveAnonDraft: h.saveAnonDraft, loadAnonDraft: h.loadAnonDraft }))

import { POST, GET } from '@/app/api/build/anon-draft/route'

function postReq(body: unknown) {
  return { json: async () => body } as any
}
function getReq(url: string) {
  const u = new URL(url)
  return { nextUrl: u } as any
}

describe('POST/GET /api/build/anon-draft (#E3.4)', () => {
  beforeEach(() => { h.saveAnonDraft.mockReset(); h.loadAnonDraft.mockReset() })

  it('POST saves the real draft for the given token', async () => {
    h.saveAnonDraft.mockResolvedValue({ ok: true })
    const res = await POST(postReq({ token: 'tok-1', idea: 'x', track: 'company', answers: {}, step: 'kickoff-1' }))
    expect(res.status).toBe(200)
    expect(h.saveAnonDraft).toHaveBeenCalledWith('tok-1', { idea: 'x', track: 'company', answers: {}, step: 'kickoff-1' })
  })

  it('POST rejects a missing token', async () => {
    const res = await POST(postReq({ idea: 'x' }))
    expect(res.status).toBe(400)
    expect(h.saveAnonDraft).not.toHaveBeenCalled()
  })

  it('GET returns the real draft for a token', async () => {
    h.loadAnonDraft.mockResolvedValue({ idea: 'x', track: 'company', answers: {}, step: 'kickoff-2' })
    const res = await GET(getReq('https://builder.ainative.studio/api/build/anon-draft?token=tok-1'))
    const body = await res.json()
    expect(body.draft.step).toBe('kickoff-2')
  })

  it('GET returns null for no token, without calling loadAnonDraft', async () => {
    const res = await GET(getReq('https://builder.ainative.studio/api/build/anon-draft'))
    const body = await res.json()
    expect(body.draft).toBeNull()
    expect(h.loadAnonDraft).not.toHaveBeenCalled()
  })
})
