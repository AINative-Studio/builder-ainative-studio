/**
 * /api/help/stuck (#321, GR-12) — the "I'm stuck" jump-to-answer retrieval API.
 *
 * POST { question: string }
 *   → { results: [{ href, title, parentTitle, source, snippet, score }] }
 *
 * Searches the FULL guides/docs catalog (every section of every /guides
 * article plus the Help Center FAQ) — not just the page the user is on — and
 * returns the top sections as deep links (/guides/{slug}#{anchor}, /help#{id})
 * so the user can jump straight to the answer.
 *
 * Retrieval is pure and local (lib/help/stuck-search.ts): no model call, no
 * network, sub-millisecond. The ranker is a swappable seam — a ZeroDB
 * embeddings backend can replace the keyword ranker without touching this
 * route (see the RANKER SEAM note in stuck-search.ts).
 *
 * Public (middleware allowlists /api/help/*): the box lives on /help and
 * /guides/[slug], both anonymous surfaces, and is agent-queryable (AX).
 */

import { NextRequest } from 'next/server'
import { searchStuck, DEFAULT_RESULT_LIMIT } from '@/lib/help/stuck-search'

export const runtime = 'nodejs'

const MAX_QUESTION_LENGTH = 500

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const question = String(body?.question || '')
    .trim()
    .slice(0, MAX_QUESTION_LENGTH)

  if (!question) {
    return Response.json({ error: 'question required' }, { status: 400 })
  }

  const results = searchStuck(question, DEFAULT_RESULT_LIMIT)
  return Response.json({ results })
}
