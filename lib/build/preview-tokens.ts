/**
 * Preview token minting (#331, #443, #814) — extracted from
 * app/api/preview/[id]/route.ts (2026-10-26, #1561) so a second caller
 * (app/build/[slug]/page.tsx, minting the SAME tokens server-side for the
 * Sandpack multi-file preview) can reuse this exact logic instead of a
 * second, hand-maintained copy that would silently drift out of sync with
 * the single-file preview route's own binding checks.
 *
 * mintPreviewDbToken/mintPreviewPrimitiveTokens are otherwise UNCHANGED from
 * their original implementation in that route file — same slug/chatId
 * binding check, same fail-to-empty-on-any-error posture.
 */
import { mintAppDataToken } from '@/lib/build/app-data-token'
import { mintPrimitiveProxyToken } from '@/lib/build/primitive-proxy-token'
import { hasFounderCredential, type FounderScopedPrimitive } from '@/lib/build/primitive-credentials'

// Kept in sync manually with lib/build/primitive-credentials.ts's
// FounderScopedPrimitive union — see the original route file's own doc
// comment (app/api/preview/[id]/route.ts) for the live-incident history
// behind why this list exists and must stay current.
export const FOUNDER_SCOPED_PRIMITIVES: FounderScopedPrimitive[] = [
  'zerocommerce', 'zeropipeline', 'agentflow', 'zeroforms', 'zerocrm',
  'zerovoice', 'zeroinvoice', 'serviceos', 'livestreaming', 'socialgraph',
]

/**
 * Both token minters below resolve the slug's registry entry the same way:
 * `resolveApp()`'s plain `null` collapses "no such company" with "the
 * registry read itself failed" — a transient hiccup during ONE preview load
 * mints no token at all, so a single immediate retry rides out most of
 * those instead of failing closed for the whole preview session.
 */
async function resolveAppForPreviewToken(slug: string) {
  const { resolveAppVerified } = await import('@/lib/build/app-registry')
  const first = await resolveAppVerified(slug)
  if (first.verified) return first.entry
  const retry = await resolveAppVerified(slug)
  return retry.entry
}

/**
 * Per-app data token (#331): mint the signed token that scopes this app's
 * /api/db calls to ITS OWN ZeroDB project — but ONLY if the slug's
 * registered chatId matches THIS preview id (the binding check: naming
 * someone else's slug on your own preview mints nothing).
 */
export async function mintPreviewDbToken(slug: string | null, previewId: string): Promise<string> {
  if (!slug || !/^[a-z0-9-]{1,64}$/i.test(slug)) return ''
  try {
    const entry = await resolveAppForPreviewToken(slug)
    if (!entry || entry.chatId !== previewId || !entry.zerodbProjectId) return ''
    return mintAppDataToken(entry.zerodbProjectId, slug, Math.floor(Date.now() / 1000))
  } catch {
    return ''
  }
}

/**
 * #443 — same binding check as mintPreviewDbToken, one token per founder-
 * scoped primitive the company actually has a stored credential for.
 * #814 — contentworkflow is always minted a binding token too (it uses
 * Builder's own service key, never gated on hasFounderCredential).
 */
export async function mintPreviewPrimitiveTokens(slug: string | null, previewId: string): Promise<Partial<Record<FounderScopedPrimitive | 'contentworkflow', string>>> {
  const tokens: Partial<Record<FounderScopedPrimitive | 'contentworkflow', string>> = {}
  if (!slug || !/^[a-z0-9-]{1,64}$/i.test(slug)) return tokens
  try {
    const entry = await resolveAppForPreviewToken(slug)
    if (!entry || entry.chatId !== previewId) return tokens
    const iat = Math.floor(Date.now() / 1000)
    await Promise.all(
      FOUNDER_SCOPED_PRIMITIVES.map(async (p) => {
        if (await hasFounderCredential(slug, p)) {
          tokens[p] = mintPrimitiveProxyToken(slug, p, iat)
        }
      }),
    )
    tokens.contentworkflow = mintPrimitiveProxyToken(slug, 'contentworkflow', iat)
  } catch {
    return {}
  }
  return tokens
}
