import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1574 — GET /api/build/sandpack-token?slug=X&chatId=Y — mints the SAME
 * per-company data token app/build/[slug]/page.tsx mints server-side, for
 * the one caller with no server boundary to mint from directly
 * (components/build/artifacts/Preview.tsx, the Sandpack preview rendered
 * inside the founder's own in-session Live dashboard). See the route file's
 * own doc comment for the full root-cause writeup and security reasoning
 * (same binding check as app/api/preview/[id]/route.ts's existing, already-
 * public token minting — no new trust boundary).
 */

const h = vi.hoisted(() => ({
  mintPreviewDbToken: vi.fn(),
  mintPreviewPrimitiveTokens: vi.fn(),
}))

vi.mock('@/lib/build/preview-tokens', () => ({
  mintPreviewDbToken: h.mintPreviewDbToken,
  mintPreviewPrimitiveTokens: h.mintPreviewPrimitiveTokens,
}))

import { GET } from '@/app/api/build/sandpack-token/route'

function getReq(url: string) {
  return { nextUrl: new URL(url) } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/build/sandpack-token (#1574)', () => {
  it('requires both slug and chatId — never calls the minters with a partial binding', async () => {
    const res1: any = await GET(getReq('http://localhost/api/build/sandpack-token?slug=groundwork'))
    expect(res1.status).toBe(400)
    const res2: any = await GET(getReq('http://localhost/api/build/sandpack-token?chatId=chat-1'))
    expect(res2.status).toBe(400)
    expect(h.mintPreviewDbToken).not.toHaveBeenCalled()
    expect(h.mintPreviewPrimitiveTokens).not.toHaveBeenCalled()
  })

  it('mints the real db token + primitive tokens when the binding matches', async () => {
    h.mintPreviewDbToken.mockResolvedValue('real-signed-db-token')
    h.mintPreviewPrimitiveTokens.mockResolvedValue({ zerocommerce: 'real-primitive-token' })

    const res: any = await GET(getReq('http://localhost/api/build/sandpack-token?slug=groundwork&chatId=chat-abc'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ dbToken: 'real-signed-db-token', primitiveTokens: { zerocommerce: 'real-primitive-token' } })

    expect(h.mintPreviewDbToken).toHaveBeenCalledWith('groundwork', 'chat-abc')
    expect(h.mintPreviewPrimitiveTokens).toHaveBeenCalledWith('groundwork', 'chat-abc')
  })

  it('returns an empty (not fabricated) token when the binding does not match — the minters themselves enforce this', async () => {
    // mintPreviewDbToken's own binding check (slug's registered chatId must
    // match the given chatId) already returns '' for a mismatch — this
    // route must not paper over that with any fallback value.
    h.mintPreviewDbToken.mockResolvedValue('')
    h.mintPreviewPrimitiveTokens.mockResolvedValue({})

    const res: any = await GET(getReq('http://localhost/api/build/sandpack-token?slug=groundwork&chatId=someone-elses-chat'))
    const json = await res.json()
    expect(json).toEqual({ dbToken: '', primitiveTokens: {} })
  })
})
