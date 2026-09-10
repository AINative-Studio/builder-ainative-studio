import { NextRequest } from 'next/server'
import { SEED_SHOWCASE, type ShowcaseEntry, generateSlug, generateDescription, combineAndDedupeShowcase, extractShowcaseTitle } from '@/lib/showcase-data'
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
          tags: ['ai-generated', 'react'],
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
