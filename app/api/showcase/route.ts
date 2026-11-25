import { NextRequest } from 'next/server'
import { SEED_SHOWCASE, type ShowcaseEntry, generateSlug, generateDescription, combineAndDedupeShowcase, extractShowcaseTitle, looksLikeUnsubstitutedPlaceholder } from '@/lib/showcase-data'
import { getDynamicShowcase, addToShowcase } from '@/lib/showcase-store'
import { listGenerations } from '@/lib/zerodb-store'
// isQualityApp lives in lib/ — Next.js 15 route modules may only export HTTP
// handlers + config, so a helper export here fails the production build.
import { isQualityApp } from '@/lib/showcase-quality'

/**
 * GET /api/showcase — List all showcase entries (seed + in-memory + ZeroDB)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')
  // Default page size raised so the gallery surfaces far more than the old 50;
  // callers can still page with offset/limit. Hard-capped to avoid huge payloads.
  const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500)
  const offset = parseInt(searchParams.get('offset') || '0')

  // Load persisted entries from ZeroDB. Read a large window (not just the most
  // recent 100) so older quality apps keep surfacing as the gallery grows —
  // listGenerations caches the result, so the bigger read is paid once.
  let zerodbEntries: ShowcaseEntry[] = []
  try {
    const rows = await listGenerations(1000)
    zerodbEntries = rows
      // Real gap fixed 2026-09-10: `is_showcase` is already computed
      // correctly at persist time (generation-persist.ts's persistGeneration:
      // status==='success' && valid && length>=2000, and NOW also excludes
      // internal/test traffic via skipShowcase) — but this route never read
      // it, relying purely on isQualityApp's much weaker length/shape check.
      // That let dozens of syntactically-valid-but-degraded, broken, or
      // internal-test generations flood the public showcase (confirmed live:
      // an App-track invoicing test that fell back to fake /api/db calls was
      // still marked showcase-eligible here). `is_showcase === true` is now
      // the primary gate; isQualityApp stays as an ADDITIONAL structural
      // check (not a substitute) for the rare legacy row saved before this
      // field existed (undefined, not explicitly true/false).
      .filter((r: any) => r?.is_showcase === true || r?.is_showcase === undefined)
      .filter((r: any) => isQualityApp(r.generated_code || '', r.chat_id))
      // builder#960 — exclude any row whose real, derived title is an
      // UNSUBSTITUTED template placeholder rather than a company name.
      //
      // This is the read-time half of the fix, and it is what actually removes
      // the two entries found live on the public /showcase (chat_ids
      // x6wOHR9rN8UDxcUyTXElZ and 7W6siLoHGM8O4rsusuIQt, both 2026-09-23),
      // titled literally `{slug}` + a trailing backtick. Those rows were
      // persisted with is_showcase: true because at persist time they looked
      // like any other successful, valid, >=2000-char generation — nothing was
      // wrong with the CODE, only with the name/idea the generation was asked
      // for. ZeroDB rows here are append-only/latest-wins with no delete path,
      // so read-time exclusion is this codebase's established way to keep a
      // bad historical row off the public gallery (exactly where the
      // is_showcase gate above already lives). The prevention half lives at
      // the real source — contexts/build-context.tsx's deep-link guard — so no
      // FUTURE generation is ever started from a placeholder in the first place.
      //
      // Checks the derived TITLE only, deliberately not the whole prompt: the
      // title is the short, displayed identity of the entry (and is what both
      // live bad rows fail on), whereas a long free-text founder prompt could
      // legitimately contain a backtick while describing real code — and
      // silently hiding a real founder's app would be a worse failure than the
      // cosmetic one being fixed here.
      .filter((r: any) => !looksLikeUnsubstitutedPlaceholder(r.title || extractShowcaseTitle(r.prompt || '')))
      .map((r: any) => {
        const title = r.title || extractShowcaseTitle(r.prompt || '')
        return {
          slug: generateSlug(title) + '-' + (r.chat_id || '').slice(0, 6),
          title,
          description: generateDescription(r.prompt || '', title),
          category: r.category || 'creative',
          prompt: r.prompt || '',
          chatId: r.chat_id,
          // NOTE: generatedCode is intentionally OMITTED from the list payload
          // (was ~9KB/entry → ~900KB/response). The grid renders metadata only
          // and loads code on demand via /api/preview/{chatId}. `hasCode` lets
          // the client keep its "real app" filter without the code. (#58)
          hasCode: true,
          // #955: these were ['ai-generated', 'react'] — dev-tool vocabulary
          // on a page for non-technical founders. 'live' and 'ai-native'
          // describe what the business actually is from a founder's
          // perspective, not the implementation.
          tags: ['live', 'ai-native'],
          featured: false,
          createdAt: r.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
        } as ShowcaseEntry
      })
  } catch (e) {
    console.warn('[Showcase] ZeroDB load failed:', e)
  }

  // Combine seed + in-memory + ZeroDB, dedupe by chatId AND normalized prompt
  // (so repeated runs of the same prompt collapse to the newest), sorted
  // featured-first then newest-first. See combineAndDedupeShowcase.
  const inMemory = getDynamicShowcase()
  let all = combineAndDedupeShowcase(SEED_SHOWCASE, [...inMemory, ...zerodbEntries])

  // Filter by category
  if (category) {
    all = all.filter(e => e.category === category)
  }

  const total = all.length
  const entries = all.slice(offset, offset + limit)

  return Response.json({
    entries,
    total,
    hasMore: offset + limit < total,
  })
}

/**
 * POST /api/showcase — Auto-add a generation to the showcase
 */
export async function POST(request: NextRequest) {
  try {
    const { prompt, chatId, codeLength } = await request.json()

    if (!prompt || !chatId) {
      return Response.json({ error: 'prompt and chatId required' }, { status: 400 })
    }

    const added = addToShowcase(prompt, chatId, codeLength || 0)
    return Response.json({ added })
  } catch (error) {
    console.error('Showcase API error:', error)
    return Response.json({ error: 'Failed to add to showcase' }, { status: 500 })
  }
}
