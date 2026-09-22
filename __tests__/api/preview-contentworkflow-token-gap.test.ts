import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #814 — contentworkflow token-shim gap.
 *
 * Root cause: contentworkflow is deliberately excluded from
 * FOUNDER_SCOPED_PRIMITIVES (it uses Builder's own service key, never a
 * per-founder credential — see lib/build/primitive-credentials.ts), so the
 * OLD mintPreviewPrimitiveTokens loop — which only minted a token for a
 * primitive when hasFounderCredential(slug, primitive) was true — could
 * NEVER produce a contentworkflow token (hasFounderCredential is never even
 * called for it, since it's not in the FOUNDER_SCOPED_PRIMITIVES list it
 * iterates). But the proxy route (app/api/primitive/[primitive]/[...path]/
 * route.ts's forward()) still calls resolveSlug(request) for contentworkflow
 * too, which requires a signed primitive-proxy token in the no-COMPANY_SLUG
 * (preview iframe) case — so contentworkflow always 401'd with
 * missing_or_invalid_token in preview, confirmed live on agentive-product.
 *
 * Fix: mintPreviewPrimitiveTokens now ALSO mints a contentworkflow token,
 * unconditionally (same slug/chatId binding check as every other primitive,
 * but with NO hasFounderCredential gate — there is no founder credential to
 * check for this primitive, so gating on one that structurally never exists
 * was the bug). These tests exercise mintPreviewPrimitiveTokens directly
 * (exported from the route for testability) with a mocked app-registry and
 * primitive-credentials module — no real network calls.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(),
  hasFounderCredential: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/primitive-credentials', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/primitive-credentials')>('@/lib/build/primitive-credentials')
  return { ...actual, hasFounderCredential: h.hasFounderCredential }
})

import { mintPreviewPrimitiveTokens } from '@/app/api/preview/[id]/route'
import { verifyPrimitiveProxyToken } from '@/lib/build/primitive-proxy-token'

describe('mintPreviewPrimitiveTokens — contentworkflow token gap (#814)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.hasFounderCredential.mockResolvedValue(false) // no founder-scoped primitive has a stored credential in these tests
  })

  it('mints a real, verifiable contentworkflow token when the slug/chatId binding matches — WITHOUT ever calling hasFounderCredential for it', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'agentive-product', chatId: 'chat-1' })

    const tokens = await mintPreviewPrimitiveTokens('agentive-product', 'chat-1')

    expect(tokens.contentworkflow).toBeTruthy()
    const payload = verifyPrimitiveProxyToken(tokens.contentworkflow!)
    expect(payload).not.toBeNull()
    expect(payload!.slug).toBe('agentive-product')
    expect(payload!.primitive).toBe('contentworkflow')

    // The whole point of the fix: contentworkflow must NEVER be gated on
    // hasFounderCredential — it has no founder credential to check.
    expect(h.hasFounderCredential).not.toHaveBeenCalledWith('agentive-product', 'contentworkflow')
  })

  it('mints a contentworkflow token even when EVERY founder-scoped primitive has no stored credential (contentworkflow is not one of them)', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-2' })
    h.hasFounderCredential.mockResolvedValue(false)

    const tokens = await mintPreviewPrimitiveTokens('acme', 'chat-2')

    expect(tokens.contentworkflow).toBeTruthy()
    expect(tokens.zerocommerce).toBeUndefined() // no credential -> no token, unaffected
  })

  it('mints BOTH a founder-scoped token and the contentworkflow token when a founder credential does exist for one primitive', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-3' })
    h.hasFounderCredential.mockImplementation(async (_slug: string, primitive: string) => primitive === 'zeropipeline')

    const tokens = await mintPreviewPrimitiveTokens('acme', 'chat-3')

    expect(tokens.zeropipeline).toBeTruthy()
    expect(tokens.contentworkflow).toBeTruthy()
    expect(tokens.zerocommerce).toBeUndefined()
  })

  it('does NOT mint a contentworkflow token when the slug/chatId binding does not match (same binding check as every other primitive)', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'a-different-chat-id' })

    const tokens = await mintPreviewPrimitiveTokens('acme', 'chat-3')

    expect(tokens.contentworkflow).toBeUndefined()
  })

  it('does NOT mint a contentworkflow token when the slug has no registry entry at all', async () => {
    h.resolveApp.mockResolvedValue(null)

    const tokens = await mintPreviewPrimitiveTokens('never-provisioned', 'chat-4')

    expect(tokens.contentworkflow).toBeUndefined()
  })

  it('mints nothing at all (fails closed) when no slug is supplied', async () => {
    const tokens = await mintPreviewPrimitiveTokens(null, 'chat-5')
    expect(tokens).toEqual({})
    expect(h.resolveApp).not.toHaveBeenCalled()
  })
})
