import { NextRequest } from 'next/server'
import { SEED_SHOWCASE, type ShowcaseEntry, generateSlug, generateDescription } from '@/lib/showcase-data'
import { getDynamicShowcase, addToShowcase } from '@/lib/showcase-store'
import { listGenerations } from '@/lib/zerodb-store'

/**
 * GET /api/showcase — List all showcase entries (seed + in-memory + ZeroDB)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  // Load persisted entries from ZeroDB
  let zerodbEntries: ShowcaseEntry[] = []
  try {
    const rows = await listGenerations(100)
    zerodbEntries = rows
      .filter((r: any) => r.code_length > 3000)
      .map((r: any) => {
        const title = r.title || r.prompt?.replace(/^Build\s+(a|an)\s+/i, '').split(/[.!]/)[0]?.trim()?.split(' ').slice(0, 6).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Untitled'
        return {
          slug: generateSlug(title) + '-' + (r.chat_id || '').slice(0, 6),
          title,
          description: generateDescription(r.prompt || '', title),
          category: r.category || 'creative',
          prompt: r.prompt || '',
          chatId: r.chat_id,
          tags: ['ai-generated', 'react'],
          featured: false,
          createdAt: r.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
        } as ShowcaseEntry
      })
  } catch (e) {
    console.warn('[Showcase] ZeroDB load failed:', e)
  }

  // Combine seed + in-memory + ZeroDB (deduplicate by chatId)
  const inMemory = getDynamicShowcase()
  const seen = new Set<string>()
  let all: ShowcaseEntry[] = [...SEED_SHOWCASE]
  for (const entry of [...inMemory, ...zerodbEntries]) {
    const key = entry.chatId || entry.slug
    if (!seen.has(key)) {
      seen.add(key)
      all.push(entry)
    }
  }

  // Filter by category
  if (category) {
    all = all.filter(e => e.category === category)
  }

  // Sort: featured first, then by date
  all.sort((a, b) => {
    if (a.featured && !b.featured) return -1
    if (!a.featured && b.featured) return 1
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

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
