import { NextRequest } from 'next/server'
import { SEED_SHOWCASE, type ShowcaseEntry, generateSlug, generateDescription, combineAndDedupeShowcase } from '@/lib/showcase-data'
import { getDynamicShowcase, addToShowcase } from '@/lib/showcase-store'
import { listGenerations } from '@/lib/zerodb-store'

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
      .filter((r: any) => (r.code_length ?? (r.generated_code || '').length) > 1500)
      .map((r: any) => {
        const title = r.title || r.prompt?.replace(/^Build\s+(a|an)\s+/i, '').split(/[.!]/)[0]?.trim()?.split(' ').slice(0, 6).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Untitled'
        return {
          slug: generateSlug(title) + '-' + (r.chat_id || '').slice(0, 6),
          title,
          description: generateDescription(r.prompt || '', title),
          category: r.category || 'creative',
          prompt: r.prompt || '',
          chatId: r.chat_id,
          generatedCode: r.generated_code || undefined,
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
