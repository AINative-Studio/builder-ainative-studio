import { NextRequest } from 'next/server'
import { SEED_SHOWCASE, type ShowcaseEntry } from '@/lib/showcase-data'
import { getDynamicShowcase, addToShowcase } from '@/lib/showcase-store'

/**
 * GET /api/showcase — List all showcase entries (seed + dynamic)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  // Combine seed + dynamic entries, most recent first
  let all: ShowcaseEntry[] = [...SEED_SHOWCASE, ...getDynamicShowcase()]

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
